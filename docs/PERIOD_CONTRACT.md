# ELISEI: единый контракт периода

Каждый GET-запрос аналитики получает:

- `date_from=YYYY-MM-DD`
- `date_to=YYYY-MM-DD`
- `period_mode=day|week|month|custom`
- `compare=1|0`
- `compare_from=YYYY-MM-DD`
- `compare_to=YYYY-MM-DD`

Каждый POST-запрос получает те же значения в заголовках `X-ELISEI-*`.
Запросы к Элу дополнительно получают `period`, `periodContext` и `context.period` в JSON-теле.

Backend middleware сохраняет разобранный диапазон в `req.period`. Для агрегирующих SQL-endpoint используйте:

```js
import { sqlPeriod } from './lib/period.js';
const filter = sqlPeriod('sale_date', req.period, 1);
const result = await pool.query(`SELECT ... WHERE ${filter.clause}`, filter.values);
```

Автоматический response-filter служит страховкой для endpoint, которые возвращают датированные строки. Агрегаты KPI должны считать период в SQL через `req.period`.
