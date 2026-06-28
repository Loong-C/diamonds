import type { GemCard, GemDefinition, GemQuadrant } from "./types";

export const STORAGE_LIMIT = 4;
export const COUNTER_LIMIT = 3;
export const WINNING_COINS = 50;
export const ACTION_POINTS_PER_TURN = 2;

const quadrantMap: Record<string, GemQuadrant> = {
  高硬高值: "high-hard-high-value",
  高硬低值: "high-hard-low-value",
  低硬高值: "low-hard-high-value",
  低硬低值: "low-hard-low-value",
};

export const GEM_DEFINITIONS: GemDefinition[] = [
  { id: "diamond", name: "钻石", hardness: 10, value: 14, count: 1, quadrant: quadrantMap.高硬高值 },
  { id: "yellow-diamond", name: "黄钻石", hardness: 10, value: 11, count: 1, quadrant: quadrantMap.高硬高值 },
  { id: "boart", name: "圆粒金刚石", hardness: 10, value: 2, count: 3, quadrant: quadrantMap.高硬低值 },
  { id: "lotus-corundum", name: "莲花刚玉", hardness: 9, value: 8, count: 1, quadrant: quadrantMap.高硬高值 },
  { id: "alexandrite", name: "紫翠玉", hardness: 8.5, value: 12, count: 1, quadrant: quadrantMap.高硬高值 },
  { id: "beryl-blue", name: "蓝柱石", hardness: 7.5, value: 4, count: 3, quadrant: quadrantMap.高硬低值 },
  { id: "beryl-green", name: "透绿柱石", hardness: 7.5, value: 3, count: 4, quadrant: quadrantMap.高硬低值 },
  { id: "morganite", name: "摩根石", hardness: 7.5, value: 6, count: 3, quadrant: quadrantMap.高硬低值 },
  { id: "red-beryl", name: "红色绿柱石", hardness: 7.5, value: 13, count: 1, quadrant: quadrantMap.高硬高值 },
  { id: "zircon", name: "锆石", hardness: 7.5, value: 2, count: 4, quadrant: quadrantMap.高硬低值 },
  { id: "watermelon-tourmaline", name: "西瓜碧玺", hardness: 7.5, value: 5, count: 3, quadrant: quadrantMap.高硬低值 },
  { id: "chrysoberyl", name: "金绿柱石", hardness: 7.5, value: 7, count: 1, quadrant: quadrantMap.高硬高值 },
  { id: "jadeite", name: "翡翠", hardness: 7, value: 9, count: 1, quadrant: quadrantMap.高硬高值 },
  { id: "amethyst", name: "紫水晶", hardness: 7, value: 4, count: 3, quadrant: quadrantMap.高硬低值 },
  { id: "phantom-quartz", name: "幽灵水晶", hardness: 7, value: 3, count: 3, quadrant: quadrantMap.高硬低值 },
  { id: "morion", name: "黑水晶", hardness: 7, value: 2, count: 3, quadrant: quadrantMap.高硬低值 },
  { id: "benitoite", name: "蓝锥矿", hardness: 6.5, value: 9, count: 4, quadrant: quadrantMap.低硬高值 },
  { id: "peridot", name: "橄榄石", hardness: 6.5, value: 5, count: 2, quadrant: quadrantMap.低硬低值 },
  { id: "rutile", name: "金红石", hardness: 6, value: 6, count: 3, quadrant: quadrantMap.低硬低值 },
  { id: "astrophyllite", name: "柱星叶石", hardness: 5.5, value: 8, count: 4, quadrant: quadrantMap.低硬高值 },
  { id: "hemimorphite", name: "异极矿", hardness: 5, value: 7, count: 4, quadrant: quadrantMap.低硬高值 },
  { id: "obsidian", name: "黑曜石", hardness: 5, value: 1, count: 3, quadrant: quadrantMap.低硬低值 },
  { id: "sphene", name: "榍石", hardness: 5, value: 9, count: 3, quadrant: quadrantMap.低硬高值 },
  { id: "lapis", name: "青金岩", hardness: 5, value: 4, count: 3, quadrant: quadrantMap.低硬低值 },
  { id: "phosphophyllite", name: "磷叶石", hardness: 3.5, value: 11, count: 4, quadrant: quadrantMap.低硬高值 },
  { id: "antarcticite", name: "南极石", hardness: 3, value: 3, count: 3, quadrant: quadrantMap.低硬低值 },
  { id: "cinnabar", name: "辰砂", hardness: 2, value: 5, count: 3, quadrant: quadrantMap.低硬低值 },
];

export function createDeck(): GemCard[] {
  return GEM_DEFINITIONS.flatMap((definition) =>
    Array.from({ length: definition.count }, (_, index) => ({
      ...definition,
      instanceId: `${definition.id}-${index + 1}`,
      listedOnTurn: null,
      cooldownReleaseTurn: null,
    })),
  );
}
