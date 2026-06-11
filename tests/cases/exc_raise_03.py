# bare raise (re-raise), raise with message, custom exception classes
try:
    try:
        raise KeyError("orig")
    except KeyError:
        print("inner handler")
        raise  # bare re-raise
except KeyError as e:
    print("re-raised", type(e).__name__, e.args)

# raise ValueError with message
try:
    raise ValueError("explicit message")
except ValueError as e:
    print("value", str(e))


# custom exception with inheritance hierarchy
class AppError(Exception):
    pass


class NotFoundError(AppError):
    pass


class PermissionError2(AppError):
    pass


# caught by the base class
try:
    raise NotFoundError("nf")
except AppError as e:
    print("base caught", type(e).__name__, str(e))

# isinstance over the hierarchy
err = NotFoundError("x")
print(isinstance(err, NotFoundError))
print(isinstance(err, AppError))
print(isinstance(err, Exception))
print(isinstance(err, PermissionError2))
