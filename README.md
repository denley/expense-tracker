# Household Expense Tracker 2025

A static web application for visualizing household spending data from CSV files. Built with React, TypeScript, Tailwind CSS, and Recharts.

## Features

- **Dashboard** — KPI summary cards, monthly spending trend with average reference line, spending by group doughnut, top 15 categories, cumulative spend
- **Category Deep Dive** — View stats by individual category, group, or all. Grouped dropdown selector, monthly trends, top merchants, searchable transaction table
- **Monthly Breakdown** — Month selector, stacked group composition chart, daily spending, category table with comparison to average
- **Trends & Insights** — Rolling 3-month average, month-over-month changes, top 10 biggest transactions, recurring merchant detection with drill-down

All charts and tables are interactive — click to navigate between views.

## Updating Data

Replace `client/public/data.csv` with your updated CSV file. The expected columns are:

| Column | Description |
|---|---|
| Date | Transaction date (DD/MM/YYYY) |
| Description | Merchant/transaction description |
| Amount | Dollar amount (e.g. $77.50) |
| Category | Spending category |
| Group | High-level category group |
| Confidence | AI categorization confidence (ignored) |
| Notes | Optional notes |

## Development

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
```

Output is in `dist/`.
