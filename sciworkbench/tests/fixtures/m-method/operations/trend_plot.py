# M3 冒烟（趋势图）：只读运行，不改全局环境。
# 用法：python trend_plot.py <csv> <out.png>
import sys
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

path = sys.argv[1] if len(sys.argv) > 1 else "sample_trend.csv"
out = sys.argv[2] if len(sys.argv) > 2 else "out_trend.png"
df = pd.read_csv(path)
fig, ax = plt.subplots()
for g, sub in df.groupby("group"):
    idx = np.argsort(sub["time"].to_numpy())
    ax.plot(sub["time"].to_numpy()[idx], sub["readout"].to_numpy()[idx], marker="o", label=g)
ax.set_xlabel("time")
ax.set_ylabel("readout")
ax.legend()
fig.savefig(out, dpi=80)
print("groups", int(df["group"].nunique()), "saved", out)
