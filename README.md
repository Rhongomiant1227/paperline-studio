# Paperline Studio

一个免费、离线优先的空白纸与网格 PDF 生成器。无需安装依赖或运行构建步骤，所有预览、编辑和 PDF 生成都在浏览器中完成。

## 本地运行

直接打开 `index.html` 即可使用。也可以用任意静态 HTTP 服务器提供这个目录。

## 功能

- A3、A4、A5、US Letter、US Legal 与自定义纸张尺寸，支持纵向/横向、mm/cm/in/pt 和 1–100 页。
- 空白、横线、方格、点阵、等距网格、等距点阵、六边形网格、康奈尔笔记和五线谱。
- 自定义网格间距、强调线周期、打印留白、康奈尔提示栏/总结区比例、线条颜色、粗细、透明度、实线/多种虚线及虚线长度和间距、纸张底色。
- 手帐、方格草稿、学习笔记和作曲草稿的一键纸张配方。
- 逐页编辑：绘制辅助线，插入可拖动的表格，复制/新增页面，撤销/重做和删除元素。
- 自动保存在当前浏览器；可将项目导出为 JSON 并在之后重新打开。
- 导出可打印的矢量 PDF。设置和文件都不会发送到服务器。

## 部署到 GitHub Pages

1. 将仓库推送到 GitHub。
2. 打开仓库 **Settings → Pages**，将 **Build and deployment → Source** 设为 **GitHub Actions**。
3. 推送到 `main`（或手动运行 `Deploy static site to GitHub Pages` workflow）。部署完成后，Pages 会提供站点地址。

工作流发布仓库根目录的静态文件，不需要 Node、包管理器或构建产物。

## 数据与兼容性

Paperline 不调用后端，也不向第三方发送页面内容。项目自动保存使用浏览器 `localStorage`；更换浏览器或清理站点数据前，请先导出 `.paperline.json` 备份。PDF 由本页写入 PDF 1.4 矢量图形，线条透明度在支持透明度的现代 PDF 查看器中保留。

## 调研参考

功能方向参考了 [PaperMan Graph Paper Generator](https://print-a-graph-paper.com) 对自定义间距、纸张尺寸、颜色与打印留白的处理，以及 [Graph Paper Generator](https://graphpapergenerator.com) 对多种网格样式和文件导出的覆盖。Paperline 将常见纸张生成能力与逐页编辑、虚线控制、可放置表格、康奈尔笔记版式和项目文件保存结合起来；本项目不加载它们的代码或资源。
