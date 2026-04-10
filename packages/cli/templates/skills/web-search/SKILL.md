---
name: web-search
description: Search the web for current information, news, facts, documentation, or anything requiring up-to-date knowledge beyond your training data. Use when the user asks about recent events, wants you to look something up, or needs information you are not confident about.
user-invocable: false
allowed-tools: [bash]
---

# Web Search Skill

Search the web via the GranClaw search proxy. The proxy handles provider selection and API keys — you only need to form good queries.

## Basic usage

```bash
curl -s "$GRANCLAW_API_URL/search?q=your+search+query" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for r in data.get('results', []):
    print(f\"[{r['title']}]({r['url']})\")
    print(f\"  {r['description']}\")
    print()
"
```

## Query best practices

- Be specific: `"Python asyncio timeout 2024"` beats `"python async"`
- For documentation: include the library name and version: `"react useEffect cleanup TypeScript"`
- For news: add a year or "latest": `"OpenAI GPT-5 2025"`
- URL-encode spaces as `+` or `%20` in curl — wrap the URL in double quotes to be safe

## Handling results

The response always has `results: [{title, url, description}]`. Results may be empty if the query is too obscure — try rephrasing.

To follow up and read a full page:
```bash
curl -sL "<url>" | python3 -c "
import sys
content = sys.stdin.read()
# Print first 3000 chars for a summary
print(content[:3000])
"
```

Or use `lynx --dump <url>` if available for cleaner text extraction.

## When to search

- User asks about something after your training cutoff
- You are not confident in a specific fact, version number, or API
- User explicitly says "look it up", "search for", "find out"
- You need current prices, news, documentation, or status

## When NOT to search

- General programming concepts you know well
- Creative writing, brainstorming, or analysis tasks
- Questions about the current workspace or codebase (use read/grep instead)
