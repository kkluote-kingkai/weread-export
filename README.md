# 微信读书数据导出 (WeRead Exporter)

Tampermonkey 用户脚本,一键导出你在微信读书的全部数据:书架、划线、想法、笔记、阅读时长。
输出 **Markdown**(人类可读)和 **JSON**(完整结构化数据)两个文件。

## 功能

- 书架列表(书名/作者/封面)
- 每本书的划线(高亮)、划线想法、书评
- 阅读进度、阅读时长、读完日期、章节映射
- 增量模式(只导出有划线的书)和全量模式
- 并发抓取 + 限速,大量书也很快

## 安装步骤

1. **装 Tampermonkey 扩展**
   - Chrome: https://chromewebstore.google.com/detail/dhdgffkkebhmkfjojejmpbldmpobfkfo
   - Edge: https://microsoftedge.microsoft.com/addons/detail/iikmkjmpaadaobahmlepeloendndfphd
   - 其他浏览器: 搜索引擎搜 "Tampermonkey" 装对应版本

2. **安装本脚本**
   - 打开 https://github.com/kkluote-kingkai/weread-export 页面(仓库待推送)
   - 点开 `weread-export.user.js` → 点 "Raw" → Tampermonkey 会自动弹出安装页
   - 点"安装"

   或手动:打开 Tampermonkey 管理面板 → 实用工具 → 导入文件 → 选择本仓库的 `weread-export.user.js`

3. **登录微信读书网页版**(只需一次)
   - 打开 https://weread.qq.com
   - 用手机微信扫码登录(脚本依赖网页版登录态,登录方式与手机 App 无关)

4. **导出**
   - 在 weread.qq.com 任意页面右下角点 **"📥 导出微信读书数据"**
   - 面板里勾选是否全量,点"开始导出"
   - 进度显示在面板中,完成后自动下载 `.md` 和 `.json` 文件
   - 若浏览器拦截第二个下载,在下载栏点"保留"

## 原理(技术说明)

- 全部使用 weread.qq.com **同源 API**,脚本在页面内运行,自动继承浏览器 Cookie,无需手动抠 Cookie
- 数据接口纯 Cookie 认证、无签名参数,无需额外密钥
- 主要接口:
  - `GET /api/user/notebook` — 全部有笔记的书(分页)
  - `GET /web/book/bookmarklist?bookId=` — 划线
  - `GET /api/review/list?bookId=&listType=11&mine=1` — 想法/书评
  - `POST /web/book/chapterInfos` — 章节标题映射
  - `GET /web/book/readinfo?bookId=` — 阅读时长/进度
  - `GET /web/shelf/sync?userVid=` — 书架
- 说明:微信读书登录态 Cookie(`wr_skey`)约 90 分钟过期,过期后重新刷新网页版页面即可(脚本会提示登录失效)

## 输出格式示例

```markdown
## 《三体》 刘慈欣

- 阅读进度: 100%
- 阅读时长: 12 小时 35 分钟
- 读完日期: 2026-01-05
- ISBN: ...
- 划线 42 条,想法 5 条

### 划线

**chapter title**

> 弱小和无知不是生存的障碍,傲慢才是。

### 划线想法

- 这段话在疫情后重读更有感觉。 (2026-01-02)
```

## 常见问题

| 问题 | 解决 |
|------|------|
| 点导出提示"登录已失效" | 刷新 weread.qq.com 页面,重新扫码登录后重试 |
| 没弹下载 | 检查浏览器是否拦截多个下载;脚本会在下载栏出现两次 |
| 某本书划线缺失 | 该书可能用了"书签"(非划线),书签暂不导出;JSON 中该书 errors 字段会有说明 |
| 想改导出内容 | 打开 Tampermonkey 管理面板编辑脚本,`buildMarkdown()` 函数可自定义格式 |

## 许可证

MIT
