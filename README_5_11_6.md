# ELISEI 5.11.6 — Search Provenance Trust

Hotfix доверия к поисковым данным SKU 360. Legacy-строки без доказанного `sourceNmID` больше не показываются. После деплоя ELISEI автоматически переочередит поток «Поисковые запросы» и пересоберёт его с новой схемой происхождения: `sourceNmID` + `searchBindingVersion=3` + `searchOrigin=organic_product_search_texts`. Только такие строки допускаются в SKU 360.
