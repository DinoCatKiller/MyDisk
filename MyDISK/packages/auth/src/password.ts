/**
 * 密码最小长度：全项目唯一来源（`D4` 单管理员体系的密码策略）。
 *
 * 本模块**不得**引入任何依赖——better-auth 的配置、`@MyDISK/api` 的入参 schema、
 * CLI 与前端表单校验都从这里取值，且前端会在浏览器里 import 它。
 */
export const MIN_PASSWORD_LENGTH = 8;
