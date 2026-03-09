import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import { BedrockRuntimeClient, GetAsyncInvokeCommand, StartAsyncInvokeCommand } from "@aws-sdk/client-bedrock-runtime";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { config } from "../lib/config.js";
import { sleep } from "../lib/utils.js";

const runtimeClient = new BedrockRuntimeClient({ region: config.awsRegion });
const s3Client = new S3Client({ region: config.awsRegion });

function parseS3Uri(uri) {
  const normalized = uri.replace(/^s3:\/\//, "");
  const [bucket, ...rest] = normalized.split("/");
  return {
    bucket,
    key: rest.join("/")
  };
}

function buildIncidentVideoPath(sessionId) {
  return `/api/incidents/${sessionId}/video`;
}

async function writeFileList(filePath, frames) {
  const lines = frames.map((frame) => `file '${frame.screenshotPath.replace(/'/g, "'\\''")}'\nduration 0.6`);
  lines.push(`file '${frames[frames.length - 1].screenshotPath.replace(/'/g, "'\\''")}'`);
  await fs.writeFile(filePath, lines.join("\n"));
}

async function composeLocalVideo(sessionId, frames, bug) {
  const sessionDir = path.join(config.artifactsDir, sessionId);
  const manifestPath = path.join(sessionDir, "frames.txt");
  const outputPath = path.join(sessionDir, "evidence.mp4");

  await writeFileList(manifestPath, frames);

  await new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        manifestPath,
        "-vf",
        "fps=24,format=yuv420p,scale=1280:-2",
        outputPath
      ],
      {
        stdio: "ignore"
      }
    );

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });

  return {
    provider: "local",
    status: "ready",
    path: outputPath,
    videoUrl: buildIncidentVideoPath(sessionId),
    summary: bug.summary
  };
}

async function startNovaReelVideo(sessionId, frames, bug) {
  if (!config.evidenceBucketUri) {
    throw new Error("S3_OUTPUT_BUCKET must be set to use Nova Reel output");
  }

  const outputUri = `${config.evidenceBucketUri.replace(/\/$/, "")}/${sessionId}/`;
  const latestFrame = frames[frames.length - 1];
  const request = await runtimeClient.send(
    new StartAsyncInvokeCommand({
      modelId: config.novaReelModelId,
      outputDataConfig: {
        s3OutputDataConfig: {
          s3Uri: outputUri
        }
      },
      modelInput: {
        taskType: "TEXT_VIDEO",
        textToVideoParams: {
          text: `${bug.evidencePrompt} Keep the narrative faithful to the visible bug state.`
        },
        videoGenerationConfig: {
          durationSeconds: 6,
          fps: 24,
          dimension: "1280x720"
        },
        images: [
          {
            format: "png",
            source: {
              bytes: Buffer.from(latestFrame.screenshotBase64, "base64")
            }
          }
        ]
      }
    })
  );

  return {
    provider: "nova-reel",
    status: "generating",
    invocationArn: request.invocationArn,
    outputUri,
    videoUrl: null,
    summary: bug.summary
  };
}

async function findVideoObject(prefixUri) {
  const { bucket, key } = parseS3Uri(prefixUri);
  const prefix = key ? `${key.replace(/\/$/, "")}/` : "";
  const listing = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 20
    })
  );

  const candidate = (listing.Contents ?? []).find((item) => /\.(mp4|mov|webm)$/i.test(item.Key ?? ""));
  if (!candidate?.Key) {
    return null;
  }

  return {
    bucket,
    key: candidate.Key
  };
}

async function waitForS3Object(bucket, key) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await s3Client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key
        })
      );
      return true;
    } catch {
      await sleep(3000);
    }
  }

  return false;
}

async function resolveNovaReelEvidence(sessionId, frames, bug, evidence) {
  let status = "InProgress";
  while (status === "InProgress") {
    await sleep(5000);
    const poll = await runtimeClient.send(
      new GetAsyncInvokeCommand({
        invocationArn: evidence.invocationArn
      })
    );
    status = poll.status ?? "Failed";

    if (status === "Completed") {
      const objectRef = await findVideoObject(evidence.outputUri);
      if (objectRef && (await waitForS3Object(objectRef.bucket, objectRef.key))) {
        return {
          ...evidence,
          status: "ready",
          bucket: objectRef.bucket,
          key: objectRef.key,
          videoUrl: buildIncidentVideoPath(sessionId)
        };
      }

      const fallback = await composeLocalVideo(sessionId, frames, bug);
      return {
        ...fallback,
        provider: "nova-reel-fallback",
        summary: `${bug.summary} Nova Reel completed but the object was not readable under ${evidence.outputUri}`
      };
    }

    if (status === "Failed") {
      const fallback = await composeLocalVideo(sessionId, frames, bug);
      return {
        ...fallback,
        provider: "nova-reel-fallback",
        summary: `${bug.summary} Nova Reel fallback triggered: ${poll.failureMessage ?? "unknown error"}`
      };
    }
  }

  return composeLocalVideo(sessionId, frames, bug);
}

export function createDocumentarianProvider() {
  return {
    async buildEvidence({ sessionId, frames, bug }) {
      if (!frames.length) {
        return null;
      }

      if (config.evidenceProvider === "nova-reel") {
        return startNovaReelVideo(sessionId, frames, bug);
      }

      return composeLocalVideo(sessionId, frames, bug);
    },

    async waitForEvidence({ sessionId, frames, bug, evidence }) {
      if (!evidence || evidence.status !== "generating") {
        return evidence;
      }

      return resolveNovaReelEvidence(sessionId, frames, bug, evidence);
    },

    async streamEvidence(evidence, res) {
      if (!evidence || evidence.status !== "ready") {
        res.status(409).json({
          error: "Video is still being generated"
        });
        return;
      }

      if (evidence.provider === "local" || evidence.provider === "nova-reel-fallback") {
        res.sendFile(evidence.path);
        return;
      }

      if (!evidence.bucket || !evidence.key) {
        res.status(404).json({
          error: "Video object metadata is missing"
        });
        return;
      }

      const object = await s3Client.send(
        new GetObjectCommand({
          Bucket: evidence.bucket,
          Key: evidence.key
        })
      );

      res.setHeader("Content-Type", object.ContentType ?? "video/mp4");
      if (object.ContentLength) {
        res.setHeader("Content-Length", object.ContentLength);
      }

      if (typeof object.Body?.pipe === "function") {
        object.Body.pipe(res);
        return;
      }

      Readable.fromWeb(object.Body).pipe(res);
    }
  };
}
