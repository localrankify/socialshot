"""The speech-to-text models: downloaded once, by themselves, the first time they are needed.

Nothing has to be run by hand. (python -m studio.fetch_model still works, for getting them ahead of time.)
- The main model (about 480 MB) hears English and is used for every video.
- The Hindi model (Meta's Omnilingual, about 290 MB to download) hears Hindi, Urdu and many other languages. It is
  used when one clip is heard again and turns out to be in Hindi or Urdu (live streams, the editor's button).
Each is unpacked next to where it will live and moved into place only when it is whole, so a download that was cut
off can never leave half a model behind."""
import shutil
import tarfile
import threading
import urllib.request

from . import config

BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
URL = f"{BASE}{config.ASR_MODEL_NAME}.tar.bz2"
_lock = threading.Lock()
state = {"doing": False, "percent": 0, "error": ""}
_hindi_lock = threading.Lock()
hindi_state = {"doing": False, "percent": 0, "error": ""}


def ready() -> bool:
    """Is the whole main model there: the word list and all three parts?"""
    d = config.ASR_MODEL_DIR
    if not (d / "tokens.txt").is_file():
        return False
    return all(any(d.glob(f"{part}*.onnx")) for part in ("encoder", "decoder", "joiner"))


def hindi_ready() -> bool:
    d = config.HINDI_MODEL_DIR
    return (d / "tokens.txt").is_file() and any(d.glob("model*.onnx"))


def _download(name, dest, st, label, size):
    """Fetch one model's archive, unpack it beside where it lives, and move it into place when whole."""
    st.update(doing=True, percent=0, error="")
    print(f"\n  Downloading the {label} (one time, about {size})...\n", flush=True)
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    tmp, part = config.MODELS_DIR / f"{dest.name}.tar.bz2", config.MODELS_DIR / f"{dest.name}.unpacking"

    def progress(blocks, bs, total):
        if total > 0:
            st["percent"] = min(99, int(blocks * bs * 100 / total))
    try:
        urllib.request.urlretrieve(f"{BASE}{name}.tar.bz2", tmp, progress)
        shutil.rmtree(part, ignore_errors=True)
        part.mkdir()
        with tarfile.open(tmp, "r:bz2") as t:
            for m in t.getmembers():  # only plain files and folders that stay inside the unpacking folder
                if (m.isfile() or m.isdir()) and not m.name.startswith(("/", "..")) and ".." not in m.name.split("/"):
                    t.extract(m, part)
        got = part / name
        if not got.is_dir():
            raise OSError("the download did not contain the model")
        shutil.rmtree(dest, ignore_errors=True)        # a half-finished one from before
        got.rename(dest)
        print(f"  The {label} is ready.\n", flush=True)
    except Exception as e:  # noqa: BLE001
        st["error"] = str(e)[-200:]
        raise RuntimeError(f"SocialShot couldn't download its {label} (about {size}, needed once). Check the "
                           "internet connection and free disk space, then try again.") from e
    finally:
        st["doing"] = False
        tmp.unlink(missing_ok=True)
        shutil.rmtree(part, ignore_errors=True)


def ensure() -> None:
    """Make sure the main model is on this computer, downloading it if it is not. One download at a time: anything
    else that needs the model meanwhile waits for it here."""
    if ready():
        return
    with _lock:
        if not ready():
            _download(config.ASR_MODEL_NAME, config.ASR_MODEL_DIR, state, "speech model", "480 MB")


def ensure_hindi() -> None:
    if hindi_ready():
        return
    with _hindi_lock:
        if not hindi_ready():
            _download(config.HINDI_MODEL_NAME, config.HINDI_MODEL_DIR, hindi_state, "Hindi speech model", "290 MB")


def fetch_hindi_later() -> None:
    """Start the Hindi model's download in the background, if it is wanted and not already on its way."""
    if not config.HINDI_ASR or hindi_ready() or hindi_state["doing"] or _hindi_lock.locked():
        return
    threading.Thread(target=lambda: _quietly(ensure_hindi), daemon=True, name="hindi-model").start()


def _quietly(fn):
    try:
        fn()
    except Exception:  # noqa: BLE001 - the English model is used meanwhile; the next clip tries again
        pass


def main():
    if ready():
        print("Speech model already present.")
    else:
        ensure()
    if config.HINDI_ASR:
        if hindi_ready():
            print("Hindi speech model already present.")
        else:
            ensure_hindi()


if __name__ == "__main__":
    main()
