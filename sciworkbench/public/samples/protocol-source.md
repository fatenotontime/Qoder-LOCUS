# SLAC 实验设计与数据管理（原作者 notebook 节选）

来源：Häußler, *From raw data to kinetic parameters: an EnzymeML-based workflow for reproducible enzyme kinetics*, DaRUS DOI 10.18419/DARUS-3337，CC BY 4.0。节选自 `book/scenarios/SLAC_kinetic_characterization.ipynb` markdown cells 0, 3, 5；译述并节选，未改动原源文件。

- 研究对象：小型漆酶 SLAC 催化 ABTS 氧化为 ABTS 自由基；考察 pH 3–5.5、温度 25–45°C。研究背景和本地课题说明仅按作者 notebook 整理，不能当成另有原始立项书。
- 实验设计：30 组动力学测定，初始 ABTS 浓度范围 0–200 µM；每个初始底物浓度有不加酶的对照。每种 pH/温度条件记录 ABTS 标准曲线与吸收光谱；以 340 nm 和 420 nm 同步跟踪底物消耗及产物生成，测量 15 分钟。
- 数据管理：光度计输出经定制解析函数转为 EnzymeML；酶和反应物信息由 EnzymeML Excel 元数据表提供，其他测量信息从仪器文件解析。
- 处理路径：对照用于扣除酶和缓冲液吸收；各条件建立标准曲线，仅使用吸光度低于 3.2 的点；限定标准曲线范围内换算浓度以避免外推；并使用底物/产物双通道做质量平衡质控。

以上是原作者公开方法摘要，评委仍需依据所给原始记录判断数据与条件之间的关联。评委输入中不包含 notebook 完整输出或其质量平衡结论。
