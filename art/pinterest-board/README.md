# 拼豆圖案收藏板导入

来源：[用户指定的 Pinterest 收藏板](https://jp.pinterest.com/o4724o4724/%E6%8B%BC%E8%B1%86%E5%9C%96%E6%A1%88/)。

本次页面标注 207 个 Pin。登录浏览器完整上下滚动多轮后，页面提供 191 个独立数字 Pin 链接，其中 190 张图片、1 条折纸玩具视频。未显示的 16 个没有可读取的链接，未用其他素材补齐。推荐区域和推广卡片不属于本次导入范围。

190 张图片有 4 张原文件完全重复；恐龙涂色线稿不属于拼豆图案。多图合集拆成独立图案，情侣和动物家庭等完整构图保留。进一步合并 6 幅像素与配色完全一致的图案，最终新增 236 个关卡。原有 210 关的顺序不变，新关卡从第 211 关追加。

每关保存原 Pin、原图地址、中文名和转换方式。授权信息按页面实际情况记录为「来源网页未标注授权」，没有把 Pinterest 收藏标成 CC0。实物照片采用近似像素化；图纸优先识别原始格点。逐项结果见 `import-report.json`，包含重复、跳过、拆图和照片近似转换记录。

## 复现

- `manifest.json`：从用户已登录浏览器的可见 DOM 采集的收藏板清单，不含登录信息。
- `assets.json`：公开原图下载记录和 SHA-256。
- `overrides.json`：人工核对的裁切区域、合集拆分、格点修正和中文命名。
- `import-report.json`：本次实际导入和不可读取数量。

```sh
node tools/pinterest-download.mjs
node tools/pinterest-review.mjs
python tools/import-pinterest.py
# 核对 art/pinterest-board/review/ 的原图与转换预览后写入关卡
python tools/import-pinterest.py --publish
python -m unittest discover -s tests -p '*_test.py'
npm test
npm run build
```

Python 需要 Pillow 与 NumPy。下载缓存、转换预览和联系表不提交 Git；关卡 JSON、清单、参数、报告和来源记录纳入版本控制。`tools/pinterest-bridge.mjs` 是仅监听本机 127.0.0.1:5186 的浏览器清单保存工具。
