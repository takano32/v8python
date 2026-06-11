# triple-quoted f-strings
x = 42
name = "bob"
s = f"""line1 {x}
line2 {name}
line3 {x:.1f}"""
print(s)
print(f'''single triple {name!r}
and {x:05d}''')
multi = f"""
{x} start
{name:>8}
end {x:,}
"""
print(multi)
y = 1000000
print(f"""{y:_} done""")
