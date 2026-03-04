import { genericSkillPack } from "./generic.js";
import { targetAppSkillPack } from "./targetApp.js";
import { youtubeSkillPack } from "./youtube.js";

const skillPacks = [youtubeSkillPack, targetAppSkillPack, genericSkillPack];

export function resolveSkillPack({ goal, startUrl, snapshot }) {
  return (
    skillPacks.find((skillPack) => skillPack.match({ goal, startUrl, snapshot })) ??
    genericSkillPack
  );
}
