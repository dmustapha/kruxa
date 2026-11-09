"""Tiny dependency-free SVG chart helpers. Colors come from CSS variables so the dashboard themes light and dark."""
import datetime, math

W, H, ML, MR, MT, MB = 760, 300, 62, 16, 14, 44
COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"]

def fmt(v):
    a = abs(v)
    if a >= 1e9: return f"{v/1e9:.3g}B"
    if a >= 1e6: return f"{v/1e6:.3g}M"
    if a >= 1e3: return f"{v/1e3:.3g}k"
    if a >= 10 or a == 0: return f"{v:.0f}"
    return f"{v:.2g}"

def nice_ticks(lo, hi, n=5):
    if hi == lo: hi = lo + 1
    raw = (hi - lo) / n; mag = 10 ** math.floor(math.log10(raw))
    step = min((s * mag for s in (1, 2, 2.5, 5, 10) if s * mag >= raw), default=raw)
    t = math.floor(lo / step) * step; out = []
    while t <= hi + step * 0.001:
        out.append(round(t, 10)); t += step
    return out

class Axes:
    def __init__(self, xlo, xhi, ylo, yhi, logy=False):
        self.xlo, self.xhi, self.logy = xlo, xhi, logy
        self.ylo, self.yhi = ylo, yhi
    def x(self, v): return ML + (v - self.xlo) / ((self.xhi - self.xlo) or 1) * (W - ML - MR)
    def y(self, v):
        if self.logy:
            v = math.log10(max(v, 1e-9)); lo, hi = math.log10(self.ylo), math.log10(self.yhi)
        else: lo, hi = self.ylo, self.yhi
        return H - MB - (v - lo) / ((hi - lo) or 1) * (H - MT - MB)

def frame(ax, ylabel, xticks, yticks):
    s = [f'<line x1="{ML}" y1="{H-MB}" x2="{W-MR}" y2="{H-MB}" class="axis"/>']
    for v in yticks:
        y = ax.y(v)
        s.append(f'<line x1="{ML}" y1="{y:.1f}" x2="{W-MR}" y2="{y:.1f}" class="grid"/><text x="{ML-6}" y="{y+4:.1f}" class="tick" text-anchor="end">{fmt(v)}</text>')
    for v, lab in xticks:
        x = ax.x(v)
        s.append(f'<line x1="{x:.1f}" y1="{H-MB}" x2="{x:.1f}" y2="{H-MB+4}" class="axis"/><text x="{x:.1f}" y="{H-MB+17}" class="tick" text-anchor="middle">{lab}</text>')
    s.append(f'<text x="14" y="{(H-MB+MT)/2}" class="tick" transform="rotate(-90 14 {(H-MB+MT)/2})" text-anchor="middle">{ylabel}</text>')
    return s

def date_ticks(dates, every_months=2):
    ticks, seen = [], None
    for i, d in enumerate(dates):
        if d.day == 1 and (d.year * 12 + d.month) % every_months == 0 and (d.year, d.month) != seen:
            ticks.append((i, d.strftime("%b %y"))); seen = (d.year, d.month)
    return ticks

def legend(names):
    return "".join(f'<g transform="translate({ML+8+i*170},{MT+8})"><rect width="12" height="3" y="4" fill="{COLORS[i]}"/><text x="18" y="9" class="tick">{n}</text></g>' for i, n in enumerate(names))

def svg(body, title, desc):
    return (f'<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d" xmlns="http://www.w3.org/2000/svg">'
            f'<title id="t">{title}</title><desc id="d">{desc}</desc>' + "".join(body) + "</svg>")

def line_chart(dates, series, ylabel, title, desc, logy=False, vlines=(), every_months=2):
    """series: list of (name, ys). dates: list of datetime.date."""
    allv = [v for _, ys in series for v in ys if v is not None and (v > 0 or not logy)]
    lo, hi = min(allv), max(allv)
    if logy: ylo, yhi = 10 ** math.floor(math.log10(lo)), 10 ** math.ceil(math.log10(hi)); yt = [10 ** e for e in range(int(math.log10(ylo)), int(math.log10(yhi)) + 1)]
    else:
        yt = nice_ticks(min(0, lo), hi); ylo, yhi = yt[0], yt[-1]
    ax = Axes(0, len(dates) - 1, ylo, yhi, logy)
    body = frame(ax, ylabel, date_ticks(dates, every_months), yt)
    for vi, lab in vlines:
        x = ax.x(vi); body.append(f'<line x1="{x:.1f}" y1="{MT}" x2="{x:.1f}" y2="{H-MB}" class="vline"/><text x="{x+4:.1f}" y="{MT+26}" class="tick">{lab}</text>')
    for si, (name, ys) in enumerate(series):
        pts = " ".join(f"{ax.x(i):.1f},{ax.y(v):.1f}" for i, v in enumerate(ys) if v is not None and (v > 0 or not logy))
        body.append(f'<polyline points="{pts}" fill="none" stroke="{COLORS[si]}" stroke-width="1.6"/>')
    body.append(legend([n for n, _ in series]))
    return svg(body, title, desc)

def bar_chart(labels, values, ylabel, title, desc, color=0, band=None):
    yt = nice_ticks(min(0, min(values)), max(values + ([band[1]] if band else [])))
    ax = Axes(0, len(values), yt[0], yt[-1])
    n = len(values); bw = (W - ML - MR) / n
    body = frame(ax, ylabel, [], yt)
    for i, (lab, v) in enumerate(zip(labels, values)):
        x = ML + i * bw; y0, y1 = ax.y(0), ax.y(v)
        body.append(f'<rect x="{x+bw*0.15:.1f}" y="{min(y0,y1):.1f}" width="{bw*0.7:.1f}" height="{abs(y1-y0):.1f}" fill="{COLORS[color]}"/>')
        if n <= 24: body.append(f'<text x="{x+bw/2:.1f}" y="{H-MB+14}" class="tick" text-anchor="end" transform="rotate(-40 {x+bw/2:.1f} {H-MB+14})">{lab}</text>')
    if band:
        y = ax.y(band[1]); body.append(f'<line x1="{ML}" y1="{y:.1f}" x2="{W-MR}" y2="{y:.1f}" class="vline"/><text x="{W-MR-4}" y="{y-4:.1f}" class="tick" text-anchor="end">{band[0]}</text>')
    return svg(body, title, desc)

def lag_chart(lags, rs_list, band, ylabel, title, desc):
    """rs_list: list of (name, {lag: r}); band: {lag: |r| null 95th pct} drawn as +/- envelope."""
    vals = [v for _, d in rs_list for v in d.values()] + list(band.values()) + [-b for b in band.values()]
    yt = nice_ticks(min(vals), max(vals)); ax = Axes(lags[0], lags[-1], yt[0], yt[-1])
    xt = [(k, str(k)) for k in lags if k % 7 == 0 or k == lags[0]]
    body = frame(ax, ylabel, xt, yt)
    up = " ".join(f"{ax.x(k):.1f},{ax.y(band[k]):.1f}" for k in lags if k in band)
    dn = " ".join(f"{ax.x(k):.1f},{ax.y(-band[k]):.1f}" for k in reversed(lags) if k in band)
    if band: body.append(f'<polygon points="{up} {dn}" class="band"/>')
    body.append(f'<line x1="{ML}" y1="{ax.y(0):.1f}" x2="{W-MR}" y2="{ax.y(0):.1f}" class="axis"/>')
    for si, (name, d) in enumerate(rs_list):
        pts = " ".join(f"{ax.x(k):.1f},{ax.y(d[k]):.1f}" for k in lags if k in d)
        body.append(f'<polyline points="{pts}" fill="none" stroke="{COLORS[si]}" stroke-width="1.8"/>')
    body.append(legend([n for n, _ in rs_list]))
    body.append(f'<text x="{W/2}" y="{H-4}" class="tick" text-anchor="middle">lag in days (positive: first series leads)</text>')
    return svg(body, title, desc)

def scatter(xs, ys, xlabel, ylabel, title, desc):
    xt = nice_ticks(0, max(xs)); yt = nice_ticks(0, max(ys))
    ax = Axes(xt[0], xt[-1], yt[0], yt[-1])
    body = frame(ax, ylabel, [(v, fmt(v)) for v in xt], yt)
    for x, y in zip(xs, ys):
        body.append(f'<circle cx="{ax.x(x):.1f}" cy="{ax.y(y):.1f}" r="4" fill="{COLORS[0]}" fill-opacity=".75"/>')
    body.append(f'<text x="{W/2}" y="{H-4}" class="tick" text-anchor="middle">{xlabel}</text>')
    return svg(body, title, desc)
