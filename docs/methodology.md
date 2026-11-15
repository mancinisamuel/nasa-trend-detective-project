# Methodology

Purpose: describe how annual values, anomalies and trends are computed, with all parameters and limits, word for word consistent with the code.

Status: Draft – wird in Phase D7 gefüllt.

## To be covered (from the architecture brief v1.0, §09)

- Variable: `T2M` (`temperature_2m`, unit `degC`, aggregation `day_weighted_mean`); `PRECTOTCORR` prepared but disabled until unit, aggregation and suitability are confirmed.
- Annual values: monthly means weighted by calendar days including leap years; only years with 12 valid months are complete; missing years stay visible.
- Common period: longest contiguous run of complete years shared by both locations within the selected window; on a tie the earlier run; the period actually used is shown.
- Baseline and anomalies: fixed baseline 1991–2020 per location; all 30 annual means must be complete, otherwise no anomalies and absolute values are shown; baseline months are loaded and cached independently of the display window; anomaly = annual value minus baseline mean.
- Trend: at least 3 contiguous common complete years (product threshold set by the team, D-05, not a universal rule); below that `trend=null` and `status="insufficient_data"`. With fewer than 10 years the trend gets the diagnostic flag `short_period` and the UI shows a note that the trend is very uncertain and the interval is usually wide. Short periods are exploratory: the HAC covariance with `maxlags=3` has very little data to work with, so their intervals and p-values are less reliable than for long series. Model: OLS `y = a + b·t` with `t` = year minus mean year; `slope_per_decade = 10·b`.
- Uncertainty: statsmodels OLS with HAC/Newey–West covariance, `maxlags=3`, `use_correction=True`, `use_t=False`; 95 % interval `b ± 1.96·SE_HAC` (×10 per decade); two-sided asymptotic p-value; interval and test from the same covariance; parameters, method version and n in the output.
- Method version `annual-ols-hac-v1`.
- Handling of edge cases and numerically degenerate cases (constant series, perfect line); no NaN or Infinity in the output.
- Limits of interpretation: interval above/below zero vs. containing zero; no causal statements; no ranking of locations as a significant difference without a dedicated comparison test; exploratory time windows without multiple-testing correction; confidence band describes the fitted mean line, not a prediction interval and not the full measurement uncertainty.
- Thresholds are our own product decisions, not NASA requirements.
