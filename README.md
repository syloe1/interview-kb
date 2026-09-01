# Interview-KB

Interview-KB is a lightweight personal interview knowledge base for project notes, Go, C++, databases, and fundamentals. It is intentionally a static frontend so the content can live alongside the code and deploy cleanly to GitHub Pages.

## Stack

- React 19 + TypeScript (strict)
- Vite
- React Router with `HashRouter` for GitHub Pages-safe routes
- Tailwind CSS v4 via `@tailwindcss/vite`
- `react-markdown` for content loading and rendering

## Structure

```text
src/
├── components/       # layout, common UI, and project UI
├── content/          # Markdown notes
├── data/             # navigation and project metadata
├── pages/            # route-level views
├── types/            # shared TypeScript models
├── App.tsx           # centralized route definitions
└── index.css         # Tailwind entry and Markdown typography
```

## Local development

```bash
npm install
npm run dev
```

## Build and preview

```bash
npm run build
npm run preview
```

## GitHub Pages

The Vite base is set to `./`, and the app uses `HashRouter`, so refreshing a nested route does not require server-side fallback rules. The workflow in `.github/workflows/deploy.yml` builds the project and publishes the `dist` folder with GitHub Pages.

In the repository settings, set Pages > Build and deployment > Source to **GitHub Actions**.

## Adding content

To add a project, add a typed entry to `src/data/projects.ts` and create a matching Markdown file under `src/content/projects/`. The project `id` and Markdown filename must match case-insensitively: `id: 'frontman'` loads `Frontman.md` at `#/projects/frontman`. The generic `/projects/:projectId` route handles new projects, so no additional React page or route is required.

To add a knowledge entry, create a Markdown file in the relevant `src/content/` folder, add its metadata to the appropriate data file, and add a route/page link when it should be browsable.

### Code blocks

Use fenced code blocks with a language name to enable syntax highlighting. C, C++, and Go are currently bundled:

````markdown
```cpp
class EventLoop {
public:
  void loop();
};
```

```go
func main() {
    fmt.Println("hello")
}
```
````

The aliases `c++`, `cc`, `hpp`, and `golang` are also supported. Level-two headings (`## Heading`) are added to the project table of contents automatically.

## Current TODOs

- Full-text search UI is present but not connected to content.
- Architecture diagram, technical details, follow-ups, and personal notes for ReactorNet are placeholders.
- Go, C++, Database, and 八股 sections are ready for notes but currently empty.
