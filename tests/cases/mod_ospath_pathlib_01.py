import os.path
from pathlib import Path

# os.path
print(os.path.join("a", "b", "c"))
print(os.path.join("/x", "y"), os.path.join("a/", "b"))
print(os.path.basename("/a/b/c.txt"), os.path.dirname("/a/b/c.txt"))
print(os.path.split("/a/b/c"))
print(os.path.splitext("/a/b.txt"), os.path.splitext("noext"))
print(os.path.normpath("a/./b/../c"), os.path.normpath("/x//y/"))
print(os.path.isabs("/a"), os.path.isabs("a"))
print(os.sep, os.name)

from os.path import join, basename
print(join("p", "q"), basename("/r/s"))

# pathlib
p = Path("/home/user/file.txt")
print(p.name, p.suffix, p.stem)
print(p.parent)
print(Path("/a/b/c").parts)
print(Path("a") / "b" / "c.txt")
print(Path("/a/b.txt").with_suffix(".md"))
print(Path("/a/b.txt").with_name("x.py"))
print(str(Path("a/b")), repr(Path("a/b")))
print(Path("/x").is_absolute(), Path("y").is_absolute())
print(Path("a").joinpath("b", "c"))
