class Account:
    bank = "ACME"

    def __init__(self, owner, balance=0):
        self.owner = owner
        self.balance = balance

    def deposit(self, amount):
        self.balance += amount
        return self.balance

    def info(self):
        return f"{self.owner}@{self.bank}: {self.balance}"


a = Account("alice")
b = Account("bob", 100)
print(a.deposit(50))
print(b.deposit(25))
print(a.info())
print(b.info())
print(Account.bank, a.bank, b.bank)

# instance attribute shadows class attribute, does not affect the class
a.bank = "LOCAL"
print(a.bank, b.bank, Account.bank)
print(a.balance, b.balance)
