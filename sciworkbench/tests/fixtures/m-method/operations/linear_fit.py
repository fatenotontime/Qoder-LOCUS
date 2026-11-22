# M3 冒烟（线性拟合）：只读运行，不改全局环境。
# 用法：python linear_fit.py <csv> [out-resid.png]
# 产物：拟合参数 + 残差图。
import sys
import pandas as pd
from scipy import stats
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

path = sys.argv[1] if len(sys.argv) > 1 else "sample_fit.csv"
out_resid = sys.argv[2] if len(sys.argv) > 2 else "out_resid.png"

df = pd.read_csv(path)
x = df["x"].to_numpy()
y = df["y"].to_numpy()
m = (x >= 0) & (x <= 10)
x, y = x[m], y[m]
r = stats.linregress(x, y)
resid = y - (r.slope * x + r.intercept)
fig, ax = plt.subplots()
ax.scatter(x, resid)
ax.axhline(0)
ax.set_xlabel("x")
ax.set_ylabel("residual")
fig.savefig(out_resid, dpi=80)
print("slope", round(r.slope, 4), "intercept", round(r.intercept, 4),
      "r", round(r.rvalue, 4), "p", r.pvalue, "stderr", round(r.stderr, 4), "resid_max", round(float(abs(resid).max()), 4))
