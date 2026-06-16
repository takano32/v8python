# eval / exec / compile

print(eval("1 + 2 * 3"))
x = 10
print(eval("x * 2 + 1"))
print(eval("len([1, 2, 3]) + max(4, 5)"))
print(eval("[i * i for i in range(5)]"))
print(eval("a + b", {"a": 100, "b": 23}))

exec("y = 7\nprint(y * 6)")

ns = {}
exec("def square(n):\n    return n * n\nresult = square(9)", ns)
print(ns["result"])

d = {"n": 5}
exec("n = n * 10", d)
print(d["n"])

code = compile("sum(range(101))", "<string>", "eval")
print(eval(code))

code2 = compile("for i in range(3):\n    print(i)", "<string>", "exec")
exec(code2)

try:
    eval("1 +")
except SyntaxError:
    print("caught SyntaxError")
