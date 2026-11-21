# Publish this package to GitHub from a phone (OneDrive → Codespaces)

Target repository: **https://github.com/raoheme/follow-the-rupee** (public). Demo video: **https://youtu.be/ZRAC-8WIdjA** (unlisted).
You need the file `mumbai-civic-lens-follow-the-rupee_submission.zip` in OneDrive. Use landscape mode and your browser's
**"Desktop site"** option for the Codespaces steps.

> The video link is already inside this zip's README. If you ever need to change it, see step E-2.

## A. Give the empty repository its first commit

A brand-new empty repository cannot open a Codespace until it has one commit.

1. Open https://github.com/raoheme/follow-the-rupee and sign in. The page shows "Quick setup".
2. Tap the **creating a new file** link. File name: `README.md`. Type any one line, e.g. `Follow the Rupee`. → **Commit changes…** → **Commit directly to the `main` branch** → **Commit changes**.

## B. Open a Codespace

1. On the repo page tap **<> Code** → **Codespaces** tab → **Create codespace on main**. Wait about a minute until VS Code opens in the browser.

## C. Get the zip into the Codespace

**Method 1 (recommended): upload from the phone.**
1. In the OneDrive app open the zip → **Download** (or Share → Save to Files), so it is stored on the phone.
2. In the Codespace open the **Explorer** (top-left file icon). Tap **⋯ / long-press an empty area → Upload…** and choose the zip.
   (iPhone: Files → Downloads or On My iPhone. Android: Downloads.)

**Method 2 (OneDrive "Anyone with the link" link):** in the terminal (step D) run
`curl -L "<paste-link>&download=1" -o package.zip`. Work/school OneDrive often blocks anonymous links; if the result is not a valid zip, use Method 1.

## D. Unpack and check (Codespace terminal)

Open the terminal: **☰ menu → Terminal → New Terminal**. Paste one line at a time:

```bash
cd /workspaces/follow-the-rupee
ls *.zip
unzip -o *.zip || python3 -m zipfile -e *.zip .
rm -f *.zip
python3 scripts/check_ready_to_publish.py
```

The last command must end with **`READY TO PUBLISH`**. If it prints `NOT READY`, read the list and fix it before continuing.

## E. Commit and push

1. ```bash
   git add -A
   git status --short | head -20
   git commit -m "Mumbai Civic Lens - Follow the Rupee: final hackathon submission"
   git push
   ```
2. To change the video link later: `python3 scripts/set_video_url.py "https://youtu.be/<new-id>"`, then `git add -A && git commit -m "Update video link" && git push`.

## F. Check on github.com

1. Open https://github.com/raoheme/follow-the-rupee: the README must show the **video thumbnail**, the screenshots and "Synthetic challenge dataset".
2. Tap the thumbnail: the unlisted video plays (also test in a private tab).
3. Look for `docs/`, `evidence/`, `crates/`, `apps/`, `HACKATHON_SUBMISSION.md`. There must be **no** `.env.local`, `node_modules/` or `target/`.
4. Paste the repo URL and the YouTube link into the submission form.
5. Stop the Codespace: https://github.com/codespaces → **⋯ → Stop codespace** (saves free hours).

## If something goes wrong

| Symptom | Fix |
|---|---|
| "Create codespace" is missing or fails | Do step A first (one commit is required). |
| "Upload…" missing or greyed out | Switch to Desktop site / landscape; reload the Codespace. |
| `ls *.zip` shows nothing | The upload landed elsewhere: drag the zip in Explorer into the repo root, or upload again. |
| `unzip: command not found` | The `|| python3 -m zipfile -e` fallback on the same line handles it. |
| `cd` fails | Run `ls /workspaces` and use the folder name it prints. |
| `push` rejected | Run `git push --force-with-lease`. Permission denied: the Codespace must be created from **your own** repository. |
| `NOT READY ... placeholder` | Run `python3 scripts/set_video_url.py "https://youtu.be/ZRAC-8WIdjA"`. |
| Thumbnail missing on GitHub | Wait a minute and refresh; unlisted videos still have thumbnails. |
