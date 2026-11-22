# M3 冒烟（配对前后）：只读运行，不改全局环境。
# 用法：python paired_pre_post.py <csv>
import sys
import pandas as pd
from scipy import stats

path = sys.argv[1] if len(sys.argv) > 1 else "sample_paired.csv"
df = pd.read_csv(path)
pre = df["pre"].to_numpy()
post = df["post"].to_numpy()
d = post - pre
print("pairs", len(d), "mean_diff", round(float(d.mean()), 4),
      "shapiro_p", round(float(stats.shapiro(d).pvalue), 4))
r = stats.ttest_rel(pre, post)
print("t", round(r.statistic, 4), "p", r.pvalue)
