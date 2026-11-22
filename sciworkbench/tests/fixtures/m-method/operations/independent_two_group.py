# M3 冒烟（独立两组）：只读运行，不改全局环境。
# 用法：python independent_two_group.py <csv>
import sys
import pandas as pd
from scipy import stats

path = sys.argv[1] if len(sys.argv) > 1 else "sample_groups.csv"
df = pd.read_csv(path)
a = df[df.group == "control"]["value"].to_numpy()
b = df[df.group == "treated"]["value"].to_numpy()
r = stats.ttest_ind(a, b, equal_var=False)
print("n", len(a), len(b), "t", round(r.statistic, 4), "p", r.pvalue)
