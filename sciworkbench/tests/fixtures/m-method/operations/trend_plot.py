# M3 冒烟（趋势图）：只读运行，不改全局环境。
# 用法：python trend_plot.py <csv> <out.png> [out-map.csv]
# 产物：趋势图 + 行→点映射表（原始行号、group、x、y）。
import sys
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

path = sys.argv[1] if len(sys.argv) > 1 else "sample_trend.csv"
out = sys.argv[2] if len(sys.argv) > 2 else "out_trend.png"
out_map = sys.argv[3] if len(sys.argv) > 3 else "out_trend-map.csv"

df = pd.read_csv(path)
fig, ax = plt.subplots()
mapping = []
for g, sub in df.groupby("group"):
    order = np.argsort(sub["time"].to_numpy())
    s2 = sub.iloc[order]
    ax.plot(s2["time"].to_numpy(), s2["readout"].to_numpy(), marker="o", label=g)
    for orig_idx, row in s2.iterrows():
        mapping.append({"row": int(orig_idx), "group": g, "x": row["time"], "y": row["readout"]})
ax.set_xlabel("time")
ax.set_ylabel("readout")
ax.legend()
fig.savefig(out, dpi=80)
pd.DataFrame(mapping).to_csv(out_map, index=False)
print("groups", int(df["group"].nunique()), "saved", out, out_map)
