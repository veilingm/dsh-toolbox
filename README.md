# dsh-toolbox

将三个独立的 DSH 插件合并为一个可安装的 bundle 包。**一次安装，三个功能行，逐行独立启停。**

## 功能行

| 行 id | 来源 | 功能 |
|---|---|---|
| `auto-reasoning` | `dsh-auto-reasoning` | 为每个显式配置的 llm-pi-ai 模型自动声明 `reasoningEfforts`（off/low/high/max），让思考深度在所有模型上可选 |
| `model-request-counter` | `dsh-model-request-counter` | 模型使用统计：设置面板「使用统计」分区 + 主界面悬浮卡片（tokens、成本、延迟、状态），从 `$DSH_HOME/sessions` 折叠历史数据 |
| `default-multimodal-model` | `dsh-default-multimodal-model` | 设置面板「默认多模态模型」分区，选择图片等多模态任务使用的 provider/model，持久化到 `$DSH_HOME/default-multimodal-model.json` |

## 逐行启停

每一行在 profile patch 中按 id 寻址，因此在 Web 端「插件」管理页或 `plugin_manager` 工具中可以单独开启/关闭。开关同时作用于宿主半侧（HTTP 路由、投影注册）和浏览器半侧（设置分区、悬浮卡片）：

- 关闭 `model-request-counter` → `/usage`、`/api/model-usage*` 路由下线，「使用统计」分区与悬浮卡片消失
- 关闭 `default-multimodal-model` → `/api/default-multimodal-model*` 路由下线，「默认多模态模型」分区消失
- 关闭 `auto-reasoning` → 不再自动补写 reasoningEfforts 声明（已写入配置的内容保留）

```
plugin_manager: set_plugin  target=include:model-request-counter  enabled=false
```

## 结构

```
dsh-toolbox/
├── package.json            # bundle 清单（zod 依赖 + DSH peer 声明）
├── cordis.patch.yml        # 插入 3 行（各自独立 id，名称为相对本文件的路径）
└── features/
    ├── auto-reasoning/         # 宿主插件（无客户端半侧）
    │   ├── index.js
    │   └── package.json        # 嵌套包名 dsh-auto-reasoning
    ├── model-request-counter/  # 宿主插件 + 客户端半侧
    │   ├── index.js, usage-scan.js, pricing.js, dashboard.html
    │   ├── types/, static/
    │   ├── client/index.js
    │   └── package.json        # 嵌套包名 dsh-model-request-counter + dsh.client 声明
    └── default-multimodal-model/
        ├── index.js
        ├── client/index.js
        └── package.json        # 嵌套包名 dsh-default-multimodal-model + dsh.client 声明
```

### 工作原理

- **行名锚定**：patch 中 insert 行的相对名称由 app-boot 按 **patch 文件所在目录**（即安装后的包根 `node_modules/dsh-toolbox/`）锚定为 file URL。因此 `./features/<feature>/index.js` 解析到各功能的宿主入口。
- **嵌套包清单是客户端半侧的关键**：DSH 的 client-modules 从 Loader 行的模块位置向上查找最近的 `package.json`，嵌套包名即浏览器模块身份。三个功能各自拥有独立的客户端 bundle（`/plugins/<嵌套包名>/client.js`），行启停时客户端 bundle 随之加入/移出启动图，互不影响。
- **行 id 沿用原插件 id**：用户 profile patch 中已有的覆盖项（如 `default-multimodal-model: disabled`）继续按 id 匹配生效。

## 安装

从 GitHub 克隆后先安装依赖，再添加为 profile 组合包：

```
git clone https://github.com/veilingm/dsh-toolbox.git
cd dsh-toolbox
pnpm install          # 安装 zod（见下方说明）
dsh plugin --profile desktop add <克隆路径>
```

pnpm 以 `link:` 方式安装本地目录，不会替它安装依赖，而 model-request-counter 功能的
投影校验依赖 zod，所以添加前需在本目录执行一次 `pnpm install`（node_modules 已被
.gitignore 排除，不随仓库分发）。

## 开发

profile patch 中已配置 HMR 监听本目录（`- id: hmr, config.root`），编辑 `features/` 下的源码会热重载。
