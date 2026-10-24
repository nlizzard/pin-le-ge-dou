# levels/ — 额外关卡图案

这个目录里的每个 `*.json`（除来源汇总 `credits.json`）都会自动成为一个新关卡，按文件名排序，排在手绘和程序生成图案之后。运行 `npm run build` 并重启服务后生效。

## 格式

```json
{
  "key": "orange-cat",
  "name": "橘猫",
  "palette": { "A": "#f4a261", "B": "#222222", "C": "#ffb4a2" },
  "rows": [
    "..A......A..",
    ".AAA....AAA.",
    "AABAAAAAABAA"
  ],
  "source": { "url": "来源页面", "author": "作者", "license": "CC0 1.0" }
}
```

- `rows` 每个字符是一个格子，`.` 表示画布外（可以做不规则轮廓和镂空）。
- `palette` 把字符映射成颜色，至少 2 种颜色。
- `source` 可选，会显示在游戏「背包 · 图鉴」的图案来源里，并汇总到 `credits.json`。

## 生成方式

Pinterest 收藏板导入说明和逐项报告见 [art/pinterest-board](../art/pinterest-board/README.md)。

```bash
# 任意图片 → 关卡
node tools/pixelize.mjs 我的图.png --size 24 --colors 8 --name 小狗 --preview

# 从开放素材库（Openverse，只取 CC0 / 公有领域）搜图 → 候选 → 挑选
node tools/fetch-art.mjs "cartoon cat" "cute food" "landscape illustration" --count 6
#   打开 art/preview.html 看效果
node tools/approve-art.mjs <key1> <key2> --name <key1>=中文名
```
