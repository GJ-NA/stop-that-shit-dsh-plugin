# 来源与出处

本包是 [lennney/stop-that-shit](https://github.com/lennney/stop-that-shit) 的
**DeepSeek Harness 本地化适配版**，不是上游官方发行物。

| 项 | 值 |
| --- | --- |
| 上游项目 | https://github.com/lennney/stop-that-shit |
| 上游版本 | 0.2.5 |
| 上游 commit | `17ffc9f` |
| 上游许可 | MIT（见 LICENSE） |

## vendored 内容

`src/` 下 18 个文件是上游 `src/` 的依赖闭包（从 `src/adapters/dsh-hooks.cjs` 出发
沿 `require` 递归解析得到），`skills/` 下两套 Skill 与 `skills/stss/references/examples.md`
来自上游同名路径，均按 MIT 保留原许可。

## 本仓库新增/修改

- `lib/index.cjs`：由上游 `dsh/lib/bridge.cjs` 改写（路径自包含、Skill 注册、停用开关）；
- `cordis.patch.yml`、`package.json`、`tests/`、`tools/localize.cjs`、`README.md`、
  `LOCALIZATION.md`：本适配版新增；
- `src/` 与 `skills/` 中的中文文案：仅替换面向人和面向模型的字符串，见 `LOCALIZATION.md`。

上游作者未参与本适配版，问题请提到本仓库：
<https://github.com/GJ-NA/stop-that-shit-dsh-plugin>。
