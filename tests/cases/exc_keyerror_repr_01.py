# KeyError.__str__ reprs its single argument (so str shows the key's repr)

try:
    {}["missing"]
except KeyError as e:
    print(e)
    print(str(e))
    print(repr(e))

# integer key
try:
    {1: "a"}[2]
except KeyError as e:
    print(e)

# tuple key keeps repr form
try:
    {}[(1, 2)]
except KeyError as e:
    print(e)

# set.remove of a missing element also raises KeyError
try:
    {1, 2}.remove(9)
except KeyError as e:
    print(e)
