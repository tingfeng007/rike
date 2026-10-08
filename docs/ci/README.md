# 启用自动检查

`learning-flow.yml` 是已经准备好的 GitHub Actions 工作流模板，包含依赖安装、同源发布检查和桌面/手机浏览器回归；运行权限限定为 contents:read。

2026-10-08 发布时，终端凭据只有 gist/read:org/repo scopes，推送 `.github/workflows/quality.yml` 被 GitHub 拒绝；已连接的 GitHub 插件也返回写入权限不足。本次没有变更凭据或扩大权限，先发布功能修复和本地发布门禁。

在 GitHub 的仓库文件编辑器，将本模板创建为 `.github/workflows/quality.yml` 并提交，即可在后续 main/codex 分支推送与 PR 时执行。也可以在用户完成 workflow scope 授权后，通过常规 Git 推送该文件。

本地运行：`npm ci`、`npm run validate`、`npx playwright install chromium`、`npm run test:e2e`。当前发布的 206 项 Node 测试及真实浏览器验收已经通过；这 12 个 Playwright 浏览器测试仍需实际执行，不能视为已通过。
