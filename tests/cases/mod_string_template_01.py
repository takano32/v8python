from string import Template

t = Template("$name is $age years old")
print(t.substitute(name="Bob", age=42))
print(t.substitute({"name": "Alice", "age": 7}))

# ${braced} form and $$ escape
print(Template("${greeting}, world! Cost: $$5").substitute(greeting="Hi"))

# kwargs override the mapping
print(Template("$a/$b").substitute({"a": 1, "b": 2}, b=9))

# safe_substitute leaves unknown placeholders untouched
print(Template("$known and $unknown").safe_substitute(known="X"))

# template attribute is accessible
print(t.template)

# missing key raises KeyError under substitute
try:
    Template("$missing").substitute(other=1)
except KeyError as e:
    print("KeyError", e)

# string.Formatter mirrors str.format
import string
fmt = string.Formatter()
print(fmt.format("{0} {key}", "pos", key="kw"))
print(fmt.vformat("{1}-{0}", ("a", "b"), {}))
