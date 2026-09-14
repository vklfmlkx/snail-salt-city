# 运行与部署

## 默认离线运行

Node.js 24.14.x—24.x，npm 11.9.0。首次安装执行 `npm ci`，复制 `.env.example` 为 `.env.local`，执行 `npm run build`、`npm start`，访问 `http://localhost:3000`。Windows 可使用 `npm.cmd`。

已有 `.env.local` 时只修改需要的字段，不重新复制覆盖。默认 Mock、真实调用关闭、调用额度为0，精选故事和小游戏不需要外部服务。`data/` 在运行时创建，不需要从维护者处获取数据库。

## 站点与知乎登录

部署时使用固定 HTTPS 公网来源。`APP_ORIGIN` 不带末尾斜杠，非默认端口需要保留：

```dotenv
APP_ORIGIN=https://game.example.com
FEATURE_ZHIHU_OAUTH=true
ZHIHU_OAUTH_APP_ID=
ZHIHU_OAUTH_APP_KEY=
ZHIHU_OAUTH_REDIRECT_URI=https://game.example.com/api/auth/zhihu/callback
```

App ID / App Key 从所属知乎黑客松项目取得，只在服务端填写。回调的协议、域名、端口、路径必须与赛事后台登记值一致。授权由用户亲自完成；游戏仅获取昵称与账号标识，不读取关注、收藏或个人创作。

首次知乎绑定保留当前访客数据；再次登录同一账号恢复原身份。若当前浏览器有另一份访客进度，系统拒绝自动合并，避免覆盖。访客可以游玩，但不能新建或重新生成故事。

## 在线生成

在上述登录配置之外，显式启用：

```dotenv
LLM_MODE=live
AI_LIVE_ENABLED=true
FEATURE_PLAYER_SCENARIO_GENERATION=true
FEATURE_ZHIHU_API=true
DEEPSEEK_API_KEY=
LLM_GLOBAL_DAILY_CALL_LIMIT=100
LLM_BUDGET_YUAN=10
```

模型为 `deepseek-flash`，Base URL 为 `https://api.deepseek.com`，Chat Completions 路径为 `/chat/completions`。凭证名称为 `DEEPSEEK_API_KEY`，只在服务端使用。活动故事接口与 OAuth 凭证相互独立，长期可用性由平台决定。

每个知乎账号每天6次生成机会，北京时间零点刷新。新建与重生成共用额度，已受理失败计次，同一请求重试不重复计次；3个私人栏位，1个社区展示栏位。服务端全局同时生成1篇，每项任务最长18分钟，有限次生成、审校与修订。

`LLM_BUDGET_YUAN` 是持久账本中的**累计**金额上限，不是每日额度；`unlimited` 表示显式取消该金额限制。`LLM_GLOBAL_DAILY_CALL_LIMIT` 不等于每天允许生成的篇数，不能替代生成任务的账号额度和预算账本。不要删除账本来重置费用记录。

普通安装、构建、测试不会调用模型。`npm run probe` 默认 dry-run；只有显式增加 `-- --live` 才会发起最多一次可能收费的探测请求，配置须由调用者在服务端环境中提供。

## 生产启动与持久化

```sh
npm ci
npm run build
npm run config:check
npm run start:server -- --port 3000
```

使用常驻 Node 进程和单实例 SQLite，HTTPS由反向代理或隧道入口处理。公网访问地址必须与 `APP_ORIGIN` 一致，不能为了穿透而关闭来源或 CSRF 校验。当前项目不直接提供多实例共享数据库方案。

需要持久保存：

- `SQLITE_FILE`：默认 `data/snail.db`，保存账号、进度、书架与任务。
- `data/research/budget.sqlite`：累计模型用量账本。
- `data/story-sources/zhihu/`：活动故事私有缓存。

保持工作目录稳定。`npm run db:backup` 生成 SQLite 一致性备份；默认数据库位于 `data/snail.db`，自定义路径时向该脚本提供 `SQLITE_FILE` 环境变量。不要把运行中的数据库文件直接覆盖，不公开 `data/`、`.env.local` 或备份目录。

`start:live` 是维护者的本地预览快捷方式，会开启在线生成并使用不限累计金额配置；不建议将其作为默认生产启动命令。正式部署优先使用 `start:server` 和显式预算。

## 图片更新

当前美术清单由 `src/server/game-assets.ts` 生成。实际使用的是封面、3张场景、7张六表情图集与创建角色页猫咪图，共12张。

同名替换压缩图片时，保留 PNG 类型、透明通道和图集排列；修改格式或文件名需要同步调整引用。更新后重新构建并重启，构建会为图片生成新内容版本，避免缓存旧图。

进入网站先下载、解码，再以本页 Blob 数据供画面使用；浏览器长期缓存减少重复访问流量。系统回收内存或清除缓存后仍可能需要重新加载。账号接口不使用公开缓存。

## 测试与运行边界

`npm test` 覆盖规则、内容、身份、额度与幂等；`npm run test:e2e` 使用3100端口、Chrome和隔离数据库，关闭真实知乎与模型访问。

Windows 为当前实测开发环境。Linux部署、长期运行和公网容量应在目标机器另行验证。社区内容治理仍需运营补充，不将生成模型的审校等同于完整审核体系。
