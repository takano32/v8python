# try/except: type-specific, multiple except, tuple of types, "as e"
try:
    1 / 0
except ZeroDivisionError as e:
    print("zde", str(e), e.args)

try:
    {}["missing"]
except KeyError as e:
    print("key", type(e).__name__, e.args)

try:
    raise TypeError("bad type")
except (KeyError, TypeError) as e:
    print("tuple", type(e).__name__, str(e))

# multiple except clauses, first matching wins
def classify(make):
    try:
        make()
    except ValueError:
        return "value"
    except LookupError:
        return "lookup"
    except Exception:
        return "other"

print(classify(lambda: (_ for _ in ()).throw(ValueError())))
print(classify(lambda: [][5]))   # IndexError is a LookupError
print(classify(lambda: 1 + "x"))  # TypeError -> other
