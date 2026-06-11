def shout(func):
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs).upper()
    return wrapper

@shout
def hello(name):
    return "hi " + name

print(hello("ann"))

# decorator with arguments
def repeat(times):
    def deco(func):
        def wrapper(*args, **kwargs):
            result = []
            for _ in range(times):
                result.append(func(*args, **kwargs))
            return result
        return wrapper
    return deco

@repeat(3)
def square(x):
    return x * x

print(square(4))

# stacked decorators
def add_exclaim(func):
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs) + "!"
    return wrapper

def add_question(func):
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs) + "?"
    return wrapper

@add_exclaim
@add_question
def base(s):
    return s

print(base("yo"))
