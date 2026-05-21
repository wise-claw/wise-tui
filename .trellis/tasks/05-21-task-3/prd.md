# 商品编辑页面开发

> cluster: `requirements-mpf275il` · repositoryId: `1778163801246` · role: `frontend`

## Description

开发商品编辑页面，支持新建商品和编辑已有商品，包含表单校验、数据提交与返回。

## Source requirements

- req-functional-1

## Subtasks

- 创建商品编辑路由 /products/new 和 /products/:id/edit
- 实现编辑表单组件（名称、描述、价格、库存、图片等字段）
- 实现表单校验逻辑（必填、数值范围、格式校验）
- 编辑模式下加载已有商品数据并填充表单
- 提交表单调用创建/更新 API
- 提交成功后返回列表页并提示操作结果

## DoD

- [ ] 新建商品表单可成功提交并返回列表
- [ ] 编辑已有商品表单可正确加载数据并提交更新
- [ ] 表单校验错误能正确展示
- [ ] 提交失败时有明确的错误提示

## Dependencies

- task-1

## Anchor

- textHash: `c2d8e3f7a1b5`
- range: [12, 16]
- contextBefore: 新增一个商品页面，包含列表
- contextAfter: 功能。
