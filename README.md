# Campus Reuse Admin Dashboard

## 仓库定位
Campus Reuse 的管理端 Web 仓库，负责管理后台登录、用户/商品/订单/举报/资金等运营管理能力。

## 关联仓库
- 后端服务：`https://github.com/GaryGuan1220/campus-reuse-backend`
- iOS 客户端：`https://github.com/GaryGuan1220/campus-reuse-ios`

## 本地运行
1. 安装依赖
```bash
npm install
```
2. 直接打开 `index.html`，或起一个静态服务。
3. 如果需要切换 API 地址，修改：
   - `app.js` 内 `API_BASE_URL`

## 环境变量与配置
当前为纯静态页，核心配置是 `app.js` 中的：
- `API_BASE_URL`

建议区分两套后端地址：
- 生产：Railway production
- 联调：本地或 staging 后端

## 测试
```bash
npm test
```

## 发布流程
1. 运行构建命令生成静态产物：
```bash
npm run build
```
2. 将 `dist/` 发布到静态托管平台（或和后端静态目录集成）。
3. 生产环境登录管理员账号做 smoke test：
   - 统计面板加载
   - 用户/订单/举报列表请求成功
   - 关键操作权限与提示正确

## Git 提交规范
- 提交前缀建议：
  - `feat(admin): ...`
  - `fix(admin): ...`
  - `chore(admin): ...`
