# M3 冒烟（描述统计）：只读运行，不改全局环境。
# 用法：python descriptive_stats.py <csv>
import sys
import pandas as pd

path = sys.argv[1] if len(sys.argv) > 1 else "sample_basic.csv"
df = pd.read_csv(path)
c = "value"
print("n", int(df[c].count()), "missing", int(df[c].isna().sum()),
      "std_ddof1", round(float(df[c].std(ddof=1)), 4))
print(df[c].describe().to_dict())
