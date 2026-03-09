import { genericSkillPack } from "./generic.js";
import { youtubeSkillPack } from "./youtube.js";

const skillPacks = [youtubeSkillPack, genericSkillPack];

export function resolveSkillPack({ goal, startUrl, snapshot }) {
  return (
    skillPacks.find((skillPack) => skillPack.match({ goal, startUrl, snapshot })) ??
    genericSkillPack
  );
}
