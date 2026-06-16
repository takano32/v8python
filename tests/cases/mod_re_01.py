import re

m = re.match(r"(\d+)-(\d+)", "12-34")
print(m.group(0), m.group(1), m.group(2), m.groups())

s = re.search(r"\d+", "abc123def")
print(s.group(), s.start(), s.end(), s.span())

print(re.match(r"\d", "abc"))

d = re.match(r"(?P<year>\d{4})-(?P<mon>\d{2})", "2020-05")
print(d.group("year"), d.group("mon"))
print(d.groupdict() == {"year": "2020", "mon": "05"})

print(re.findall(r"\d+", "a1b22c333"))
print(re.findall(r"(\w)(\d)", "a1b2"))
print([m.group() for m in re.finditer(r"\w+", "hi there world")])

print(re.sub(r"\d+", "#", "a1b22c"))
print(re.sub(r"(\w)(\d)", r"\2\1", "a1b2"))
print(re.sub(r"\d+", lambda m: str(int(m.group()) * 2), "a3b5"))

print(re.split(r"[,;]", "a,b;c,d"))

print(re.findall(r"[a-z]+", "Hello World", re.IGNORECASE))

p = re.compile(r"\d+")
print(p.findall("a1b2"), p.match("12").group())

print(bool(re.fullmatch(r"\d+", "123")), bool(re.fullmatch(r"\d+", "12a")))
print(re.escape("a.b*c+d"))
