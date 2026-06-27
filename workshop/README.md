# Terminal workshop deck

The architecture illustrations are deliberately written as Unicode box art in
[`slides.md`](./slides.md). They remain readable in source control, over SSH, in
terminal recordings, and with ordinary tools such as `less`. Presenterm adds
slide navigation, incremental reveals, speaker notes, hot reload, and overflow
checks without making the diagrams depend on its renderer.

## Preview while editing

```sh
mise run workshop:preview
```

Presenterm watches the Markdown file and reloads the changed slide. A terminal
of at least 100 columns by 36 rows is recommended.

## Present

```sh
mise run workshop:present
```

Useful controls:

- `Space`, `l`, or `→`: advance
- `h` or `←`: go back
- `Ctrl-p`: open the slide index
- `?`: show all key bindings
- `q`: quit

The presentation task validates that slides fit the current terminal. The deck
uses no image protocol, so it also works when Kitty graphics passthrough is not
available. Ghostty does support that protocol, and Presenterm can use it for
optional images later.

## Why this format

- [Presenterm](https://mfontanini.github.io/presenterm/) is a terminal-native
  Markdown presenter with pauses, layouts, speaker notes, and export support.
- [Presenterm image support](https://mfontanini.github.io/presenterm/features/images.html)
  can use Kitty, iTerm2, or Sixel graphics, but falls back to coarse character
  blocks when none is available.
- [Ghostty supports Kitty graphics](https://ghostty.org/docs/features), but
  text-native diagrams are more portable and remain useful outside a live talk.
