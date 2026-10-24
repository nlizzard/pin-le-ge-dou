# 推荐区扩充到1018关

来源：[用户指定的 Pinterest 收藏板](https://jp.pinterest.com/o4724o4724/%E6%8B%BC%E8%B1%86%E5%9C%96%E6%A1%88/)下方“找寻更多点子”。从已登录浏览器的可见页面采集1047个新的数字 Pin 链接，不含账户凭据。

逐页审阅原图及转换预览，排除国旗、旗帜、重复图案、裁切不完整、编号残留和不适合转换的素材。合集按独立主体拆分，实际选入573张新图案。移除旧目录的1张旗帜图案后，总数为1018张；其余445张原图案编号保持不变。没有用随机配色或重复图案凑数。

每张新图保留原 Pin、图片地址、中文名与转换方式。图纸优先按格点采样；无法可靠识别网格的素材采用像素化。来源网页未标注授权，来源记录如实保留这一信息。

- `manifest.json`、`assets.json`：公开页面清单、原图地址和文件摘要。
- `curation.json`：人工选图、旗帜排除审核、裁切与拆图参数。
- `import-report.json`：导入、备用、重复和跳过的逐项记录。
- `previous-catalog.json`、`catalog-order.json`：旧编号快照和稳定关卡顺序。

## 复现

```sh
yarn node tools/pinterest-download.mjs art/pinterest-recommendations
python tools/pinterest-review.py art/pinterest-recommendations
python tools/import-recommendations.py
# 核对原图与转换预览，再发布已审核图案
python tools/import-recommendations.py --publish
python -m unittest discover -s tests -p '*_test.py'
yarn typecheck
yarn test --maxWorkers=2
yarn build
yarn node server/index.js
```

Python需要Pillow与NumPy。原图缓存、转换缓存和联系表不提交Git；关卡、参数、清单、来源与报告纳入版本控制。

在1000关基础上，从已审核备用图案继续追加18张到第1001—1018关，原1000关顺序与数据保持不变。
