# Changesets

每个会改变已发布包行为的 PR 附带一个 changeset：`pnpm changeset`，选中受影响的包和 semver 级别，写一句用户视角的变更说明。合并到 main 后，Release 工作流会开一个聚合版本号与 CHANGELOG 的 "Version Packages" PR；合并该 PR 即发布到 npm。
