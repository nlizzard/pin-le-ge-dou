/**
 * 手绘原创像素图案。
 * 每个字符是一个格子：'.' 表示画布外（允许不规则轮廓和镂空），其余字符查 palette 得到颜色。
 * 行长度不一致时会自动在右侧补 '.'。
 */
export interface Pattern {
  key: string;
  name: string;
  palette: Record<string, string>;
  rows: string[];
}

export interface PatternSource {
  url?: string;
  image?: string;
  title?: string;
  author?: string;
  license?: string;
}

const HAND_DRAWN: Pattern[] = [
  {
    key: 'heart',
    name: '小爱心',
    palette: { D: '#c2185b', R: '#ff5f7e', P: '#ffb3c4', W: '#fff4f6' },
    rows: [
      '..DDD...DDD..',
      '.DRRRD.DRRRD.',
      'DRWWRRDRRRRRD',
      'DRWRRRRRRRRPD',
      'DRRRRRRRRRRPD',
      'DRRRRRRRRRPPD',
      '.DRRRRRRRRPD.',
      '..DRRRRRRPD..',
      '...DRRRRPD...',
      '....DRRPD....',
      '.....DRD.....',
      '......D......',
    ],
  },
  {
    key: 'watermelon',
    name: '西瓜片',
    palette: { R: '#ff6b6b', B: '#3d2b2b', W: '#f1f8e3', G: '#4caf50', D: '#2e7d32' },
    rows: [
      'RRRRRRRRRRRRRRRRRRRR',
      'RRRBRRRRRRRBRRRRRBRR',
      'GRRRRRRBRRRRRRRRRRRG',
      'DGRRRRRRRRRRBRRRRRGD',
      '.DGWRBRRRRRRRRRBRWGD',
      '..DGWRRRRRBRRRRRWGD.',
      '...DGWWRRRRRRRRWWGD.',
      '....DGGWWWWWWWWGGD..',
      '.....DDGGGGGGGGDD...',
      '.......DDDDDDDD.....',
    ],
  },
  {
    key: 'luckycat',
    name: '招财猫',
    palette: { K: '#5b4646', W: '#fffaf0', P: '#ffb3c6', R: '#e53935', Y: '#ffd54f', G: '#9ccc65' },
    rows: [
      '.KK..........KK...',
      '.KPK........KPK...',
      '.KPPK......KPPK...',
      '.KWWWKKKKKKWWWK...',
      '.KWWWWWWWWWWWWK...',
      'KWWWWWWWWWWWWWWK..',
      'KWWKKWWWWWWKKWWK..',
      'KWWKGWWWWWWKGWWK..',
      'KWPPWWWKKWWWWPPK..',
      'KWWWWWWWWWWWWWWK..',
      '.KWWWWWWWWWWWWK...',
      '..KKRRRRRRRRKK..KK',
      '..KWWWWYYWWWWK.KWK',
      '..KWWWWYYWWWWKKWWK',
      '..KWWWWWWWWWWWWWK.',
      '..KWWKWWWWKWWWWK..',
      '..KKKKKKKKKKKKKK..',
    ],
  },
  {
    key: 'strawberry',
    name: '草莓',
    palette: { G: '#43a047', L: '#81c784', R: '#f44336', Y: '#ffeb3b', D: '#c62828' },
    rows: [
      '.....GGGG.....',
      '...GGLGGLGG...',
      '..GG.GGGG.GG..',
      '..RRRGGGGRRR..',
      '.RRRRRRRRRRRR.',
      'RRYRRRRYRRRRYR',
      'RRRRRYRRRRYRRD',
      'RRYRRRRRYRRRRD',
      '.RRRRYRRRRRYD.',
      '.RRYRRRRYRRRD.',
      '..RRRRRYRRRD..',
      '..RRYRRRRRYD..',
      '...RRRRYRRD...',
      '....RRRRRD....',
      '.....RRRD.....',
      '......DD......',
    ],
  },
  {
    key: 'house',
    name: '小房子',
    palette: { R: '#e57373', C: '#90a4ae', W: '#fff3e0', B: '#64b5f6', D: '#8d6e63', Y: '#ffd54f', G: '#7cb342' },
    rows: [
      '.......RR.......',
      '......RRRR......',
      '.....RRRRRR..CC.',
      '....RRRRRRRR.CC.',
      '...RRRRRRRRRRCC.',
      '..RRRRRRRRRRRRR.',
      '.RRRRRRRRRRRRRRR',
      'RRRRRRRRRRRRRRRR',
      '.WWWWWWWWWWWWWW.',
      '.WBBWWWWWWWWBBW.',
      '.WBBWWWDDWWWBBW.',
      '.WWWWWWDDWWWWWW.',
      '.WWWWWWDDWWWWWW.',
      '.WWWWWWDYWWWWWW.',
      '.WWWWWWDDWWWWWW.',
      'GGGGGGGGGGGGGGGG',
    ],
  },
  {
    key: 'mushroom',
    name: '小蘑菇',
    palette: { R: '#ef5350', W: '#ffffff', C: '#ffe0b2', K: '#4e342e', P: '#f8bbd0' },
    rows: [
      '.....RRRRRR.....',
      '...RRRRWWRRRR...',
      '..RRWWRRRRRRRR..',
      '.RRWWWRRRRWWRRR.',
      '.RRRRRRRRWWWWRR.',
      'RRRRRRRRRRWWRRRR',
      'RRWWRRRRRRRRRRRR',
      'RWWWWRRRRRRWWRRR',
      'RRWWRRRRRRWWWWRR',
      '.RRRRRRRRRRRRRR.',
      '....CCCCCCCC....',
      '....CCKCCKCC....',
      '....CPCCCCPC....',
      '....CCCCCCCC....',
      '.....CCCCCC.....',
    ],
  },
  {
    key: 'chick',
    name: '小鸡',
    palette: { Y: '#ffe066', W: '#fff59d', K: '#3e2723', O: '#ff9800', P: '#ffab91' },
    rows: [
      '......YY......',
      '.....YYYY.....',
      '....YYYYYY....',
      '...YYYYYYYY...',
      '...YYKYYKYY...',
      '..YYYYOOYYYY..',
      '..YYPYOOYPYY..',
      '.YYYYYYYYYYYY.',
      'YYYYYYYYYYYYYY',
      'YWWYYYYYYYYWWY',
      '.YWYYYYYYYYWY.',
      '..YYYYYYYYYY..',
      '....O....O....',
      '...OOO..OOO...',
    ],
  },
  {
    key: 'donut',
    name: '甜甜圈',
    palette: { B: '#d7a86e', P: '#f48fb1', Y: '#fff176', G: '#80cbc4', R: '#7e57c2' },
    rows: [
      '.....BBBBBB.....',
      '...BBPPPPPPBB...',
      '..BPPPYPPPPPPB..',
      '.BPPGPPPPPRPPPB.',
      '.BPPPPPPPPPPPPB.',
      'BPPRPPBBBBPPGPPB',
      'BPPPPB....BPPPPB',
      'BPYPPB....BPPYPB',
      'BPPPPB....BPPPPB',
      'BPPPPPBBBBPPPPRB',
      '.BBPPPPPPPPPPPB.',
      '.BBBPPGPPPPPPBB.',
      '..BBBBPPPPPBBB..',
      '...BBBBBBBBBB...',
      '.....BBBBBB.....',
    ],
  },
  {
    key: 'fish',
    name: '小鱼',
    palette: { B: '#4fc3f7', L: '#b3e5fc', W: '#ffffff', K: '#263238', O: '#ffb74d' },
    rows: [
      '......BBBBB.......',
      '....BBBBBBBBB...OO',
      '..BBWKBBLBBBBB.OOO',
      '.BBBKKBBBLBBBBOOOO',
      'BBBBBBBBBBLBBBBOO.',
      'BBBBBBBBBBLBBBBO..',
      '.BBBBBBBBBLBBBBOO.',
      '..BBBBBBBBLBBBOOOO',
      '....BBBBBBBBB..OOO',
      '......BBBBB.....OO',
    ],
  },
  {
    key: 'mountain',
    name: '雪山日出',
    palette: { S: '#bbdefb', Y: '#ffca28', W: '#ffffff', M: '#7e7fb8', G: '#66bb6a', L: '#a5d6a7' },
    rows: [
      'SSSSSSSSSSSSSSSSYYSSSS',
      'SSSSSSSSSSSSSSSYYYYSSS',
      'SSSSSSSSSSSSSSSYYYYSSS',
      'SSSSSSSSWSSSSSSSYYSSSS',
      'SSSSSSSWWWSSSSSSSSSSSS',
      'SSSSSSWWMWWSSSSSSSSSSS',
      'SSSSSWMMMMMWSSSSWSSSSS',
      'SSSSMMMMMMMMMSSWWWSSSS',
      'SSSMMMMMMMMMMMMMMWWSSS',
      'SSMMMMMMMMMMMMMMMMMWSS',
      'SMMMMMMMMMMMMMMMMMMMMS',
      'GGGGGGGGGGGGGGGGGGGGGG',
      'GGLGGGGGGLGGGGGGGLGGGG',
      'GGGGGGLGGGGGGGLGGGGGGG',
    ],
  },
  {
    key: 'icecream',
    name: '冰淇淋',
    palette: { P: '#f8bbd0', W: '#ffffff', R: '#e91e63', M: '#a5d6a7', C: '#e0a96d', B: '#a1683a' },
    rows: [
      '....PPPP....',
      '..PPPPPPPP..',
      '.PPWPPPPPPP.',
      '.PPPPPPRPPP.',
      'PPPPPPPPPPPP',
      'MMMMMMMMMMMM',
      '.MMWMMMMMRM.',
      '.MMMMMMMMMM.',
      '..CCCCCCCC..',
      '..CBCCCCBC..',
      '...CCBCCC...',
      '...CCCCBC...',
      '....CBCC....',
      '....CCCC....',
      '.....CC.....',
      '.....CC.....',
    ],
  },
  {
    key: 'cherry',
    name: '樱桃',
    palette: { G: '#66bb6a', K: '#6d4c41', R: '#e53935', W: '#ffcdd2', D: '#b71c1c' },
    rows: [
      '..........GG..',
      '........GGG...',
      '.......K......',
      '......K.K.....',
      '.....K...K....',
      '....K.....K...',
      '...K.......K..',
      '.RRRR.....K...',
      'RRWRRR..RRRR..',
      'RWRRRR.RRWRRR.',
      'RRRRRR.RWRRRR.',
      'RRRRRD.RRRRRR.',
      '.RRRD..RRRRRD.',
      '........RRDD..',
    ],
  },
  {
    key: 'cactus',
    name: '仙人掌',
    palette: { G: '#4caf50', L: '#a5d6a7', T: '#e07a5f', O: '#b5523b', P: '#f48fb1' },
    rows: [
      '......PP......',
      '.....GGGG.....',
      '.....GLGG.....',
      '.GG..GGGG.....',
      'GGGG.GGLG..GG.',
      'GLGG.GGGG.GGGG',
      'GGGGGGGGG.GGLG',
      '.GGGGGLGGGGGGG',
      '.....GGGGGGGG.',
      '.....GGLG.....',
      '.....GGGG.....',
      '...TTTTTTTT...',
      '...TTTTTTTT...',
      '....TOTTTOT...',
      '....TTTTTTT...',
      '.....TTTTT....',
    ],
  },
  {
    key: 'rabbit',
    name: '小白兔',
    palette: { W: '#fafafa', P: '#f8bbd0', K: '#455a64', C: '#ffe0e6' },
    rows: [
      '...WW....WW...',
      '..WPPW..WPPW..',
      '..WPPW..WPPW..',
      '..WPPW..WPPW..',
      '..WPPW..WPPW..',
      '..WWWWWWWWWW..',
      '.WWWWWWWWWWWW.',
      'WWWKWWWWWWKWWW',
      'WWWWWWPPWWWWWW',
      'WCCWWWWWWWWCCW',
      '.WWWWWKKWWWWW.',
      '..WWWWWWWWWW..',
      '.WWWWWWWWWWWW.',
      'WWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWW',
      '.WW.WWWWWW.WW.',
    ],
  },
  {
    key: 'panda',
    name: '熊猫',
    palette: { K: '#37474f', W: '#ffffff', P: '#f8bbd0', G: '#8bc34a' },
    rows: [
      '.KKK.......KKK.',
      'KKKKWWWWWWWKKKK',
      'KKWWWWWWWWWWWKK',
      '.WWWWWWWWWWWWW.',
      'WWKKKWWWWWKKKWW',
      'WKKWKKWWWKKWKKW',
      'WKKKKWWWWWKKKKW',
      'WWKKWWWKWWWKKWW',
      'WWWWWWKKKWWWWWW',
      '.WWPWWWKWWWPWW.',
      '..WWWWWWWWWWW..',
      '.GGWWWWWWWWWGG.',
      'GGGGWWWWWWWGGGG',
    ],
  },
  {
    key: 'rainbow',
    name: '彩虹',
    palette: { R: '#ef5350', O: '#ffa726', Y: '#ffee58', G: '#66bb6a', B: '#42a5f5', P: '#ab47bc', W: '#ffffff' },
    rows: [
      '......RRRRRRRRRR......',
      '....RRROOOOOOOORRR....',
      '...RROOYYYYYYYYOORR...',
      '..ROOYYGGGGGGGGYYOOR..',
      '.ROYYGGBBBBBBBBGGYYOR.',
      '.ROYGGBBPPPPPPBBGGYOR.',
      'ROYGGBBPP....PPBBGGYOR',
      'ROYGBBPP......PPBBGYOR',
      'ROYGBPP........PPBGYOR',
      'ROYGBP..........PBGYOR',
      'WWWWWW..........WWWWWW',
      '.WWWW............WWWW.',
    ],
  },
];

/**
 * levels/*.json：用 tools/pixelize.mjs 或 tools/fetch-art.mjs 生成的额外图案，
 * 按文件名排序追加在手绘图案之后。格式与上面相同，可带 source（素材来源）。
 */
const extraModules = import.meta.glob('../../../levels/*.json', { eager: true, import: 'default' }) as Record<string, Pattern & { source?: PatternSource }>;

function valid(p: Pattern): boolean {
  return !!p && typeof p.key === 'string' && Array.isArray(p.rows) && p.rows.length > 0 && typeof p.palette === 'object' && p.rows.every((r) => [...r].every((ch) => ch === '.' || ch === ' ' || p.palette[ch]));
}

export const EXTRA_PATTERNS: (Pattern & { source?: PatternSource })[] = Object.keys(extraModules)
  .filter((f) => !f.endsWith('credits.json'))
  .sort()
  .map((f) => extraModules[f])
  .filter((p) => {
    if (valid(p)) return true;
    console.warn('忽略无效的关卡文件', p);
    return false;
  });

export const PATTERNS: Pattern[] = [...HAND_DRAWN, ...EXTRA_PATTERNS.filter((p) => !HAND_DRAWN.some((h) => h.key === p.key))];
