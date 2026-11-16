# 测试样本主核验记录

2026-11-16。资料检索、下载与整理已完成；本记录根据实际文件审核版权、完整性与静态安全。这里不表示科研结论正确或已经重新运行原作者软件。

## 来源许可

DaRUS DOI 10.18419/DARUS-3337，源API metadata明确CC BY4.0，134文件，合计5,723,039字节。来源是Max Häußler的硕士论文/JupyterBook，不得称期刊论文。SLAC数据另署Alaric Prins，chymotrypsin另署Marwa Mohamed等原作者致谢。原件按目录/文件ID/MD5核对，许可继承至无例外的记录材料，派生须注明来源与修改。

数据集并非所有情形均为未处理仪器读数：SLAC有原始plate reader时间序列与校准/光谱；chymotrypsin明确已扣空白，不能假装存在未扣空白记录。具体候选必须声明其起点范围，不拿作者软件输出当独立金标准。

## 实际核验与纠正

1. 早期SLAC子集只取一个pH和notebook，缺校准/光谱/parser，不合格，已要求补齐，不作为最终包。
2. 检出xlsm内vbaProject.bin，未执行。要求原件隔离审阅、评委改用有源hash映射的无宏CSV；不是仅给“可启用宏”警告。
3. 源134核对时发现自写README覆盖ID196288原件，要求恢复。恢复后134/134 MD5匹配（零缺失/不匹配）。
4. source-review.zip、developer-reference.zip、evaluator-safe-input.zip CRC检查通过，未见路径穿越。安全包当时无xlsm/py/ipynb/pkl/exe/js。后续新增文件/重打包须重验。
5. SLAC最初评委包没有外部产物且五步是离线看文件，不满足用户网站验证，已退回补作者公开小图/表、方案节选、课题说明及LOCUS五步。
6. Chymotrypsin三xlsx均无宏、OOXML ZIP完整、源MD5匹配；notebook明确真实湿实验、测量已扣空白、M3首点原分析排除，须保留并说明。最初README仍称评委包含notebook、相对metadata路径错误，已退回纠正和物理分包。
7. 电化学候选数据与教程记录CCBY4，但先取LSV段不能证明与FE/GC长时输出对应；后教程自含Figure3left完整处理链，物理方法授权/具体映射仍不足。未批准进入最终评委包。接受稿可公开访问不代表可再分发。
8. 电化学接受稿提到的Zenodo8319625在初次检索中被误作目标SI，后核实是另一研究，已排除。不得拼接补齐。
9. OSM Sydney档案All Rights Reserved与项目默认CCBY冲突，未批准再分发。受限TLC数据/仅算法色谱fixture同样不进最终完整实验包，见不予收录的候选报告。

## 核验范围与最终状态

最终批准：SLAC、Chymotrypsin、CotA三案，APPROVED仅限09_SAMPLE_BINDING所列的各自公开实验分析链。三案源于同一DaRUS记录，不是三个独立来源。无手写本，不能声明OCR已验证。

最终评委ZIP全部CRC通过；SLAC 138条、Chymotrypsin 10条、CotA 8条文件哈希清单逐条一致。CotA两条CSV派生hash/实际路径一致，方案中的105分钟答案已移除。五张作者外部结果PNG逐一与源notebook输出字节hash一致；SLAC流程图另与源PNG核对一致。最终总包及六个内嵌ZIP CRC检查通过。

最终总包LOCUS_测试样本验收包_v1.zip仅供开发验收，不能整个上传为首页评委输入，按总索引取单独安全ZIP。历史不完整候选、分段下载、宏source-review不进入总包。

静态核验不执行宏/notebook/下载代码，不等于反病毒认证，也未独立重算全部拟合。评委不需重新做物理实验或安装外部软件。原作者结果为“外部成果提交示例”，不是系统预先内置的隐藏正确答案。

## approved 的准确含义

approved = 材料审核通过（限定用途）。三案可以作为所声明范围内的实验分析流程输入，不代表用户最终验收，不代表站点功能通过，也不代表OCR测试通过。手写识别测试仍未完成。对外应使用完整中文状态，不能只展示一个无范围的approved。
