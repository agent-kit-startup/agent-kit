# Agent Kit Public Landing (agent.startupkit.com.br)

**New domain:** [https://agent.startupkit.com.br](https://agent.startupkit.com.br) (static deployment)  
**Previous:** `startupkit.com.br/agentkit` (WordPress page ID 3001, deprecated due to wpautop issues)

**Design system:** STK visual identity + Mission Control tokens (`dashboard/dashboard.html`)  
**Source of record:** `.cursor/context/landing-agentkit/page-content.html` (complete HTML/CSS/assets)

**Product claims:** track shipped **4.8.4**  
**Positioning:** human-in-the-loop framework (ADR `2026-07-09_framework-hitl-positioning.md`)  
**Copy style:** STK conversational tone adapted for developers

## Deployment Configuration

### Static Site Setup
- **Hosting:** Static files (HTML/CSS/JS) on CDN or dedicated hosting
- **DNS:** Configure `agent.startupkit.com.br` CNAME or A record
- **Assets:** Self-contained in `page-content.html` (no external dependencies)
- **SSL:** Required for production deployment

### Domain Migration Strategy
```bash
# From WordPress setup
OLD: startupkit.com.br/agentkit (WordPress page ID 3001)
NEW: agent.startupkit.com.br (clean static deployment)

# DNS Configuration
Type: CNAME or A record
Host: agent
Domain: startupkit.com.br
Target: [hosting provider endpoint]
```

### SEO Configuration
- **Title:** Agent Kit — Plan, build, ship, and remember AI coding projects
- **Meta description:** Stop losing context between AI chats. Agent Kit provides checkable plans, smart handoffs, and staging-first git workflow for long coding projects.
- **H1 hierarchy:** Page title → Hero H2 → Section headers
- **OpenGraph:** Include for social sharing (title, description, image)
