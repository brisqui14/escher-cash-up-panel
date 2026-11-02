# Cash up a service counter - React track

## Your task

At the end of a shift, a counter operator counts the cash in their drawer
and compares it with the amount expected from the shift's recorded
activity.

Build the operator's cash-up interface in React, using the supplied C#
API. The API's behavior is described in `API-CONTRACT.md`; you are
expected to run it, not to change or redesign it. Read `README.md` for
setup and the parts of the starter you will work in.

You do not need postal or accounting knowledge.

## The domain concept: variance

```text
Expected cash = opening cash + cash sales - cash refunds
Variance      = counted cash - expected cash
```

A positive variance is a surplus. A negative variance is a shortage. Zero
means the count matches.

The supplied example has one drawer, one shift, and one currency (EUR):

| Activity | Amount |
|---|---:|
| Opening cash | 100.00 |
| Cash sale | 55.00 |
| Cash sale | 27.50 |
| Cash refund | 7.50 |
| Expected cash | 175.00 |

If the operator counts 173.00, the variance is -2.00: a shortage.
**A discrepancy is not permission to change the opening balance or
transactions to make the numbers agree.**

## Required rules

1. A count is a nonnegative monetary amount with at most two decimal
   places. The API represents it as an integer number of minor units:
   173.00 is `17300`.
2. Before a count is entered, the count and variance are absent, not zero.
3. The operator can save and revise a draft, including an unfinished
   explanation. Saving a draft does not finalize it.
4. Finalization requires a count. Any nonzero variance also requires a
   nonblank explanation. A matching count does not require an explanation.
5. Invalid operations must not change the stored closeout.
6. Finalization preserves the expected cash, count, variance, explanation,
   and a server-generated UTC finalization time. A finalized closeout
   cannot be edited.
7. Retrying finalization returns the same finalized closeout, including
   the same timestamp. It must not create a second closeout.

The API enforces these rules. Your interface should help the operator
follow them, present normal monetary amounts rather than minor units,
and handle the API's responses correctly, including failures.

The expected balance comes from the supplied opening balance and
transactions, never from an amount entered by the operator.

## Environment

**Working at home.** You provide the computer (Windows, macOS, or Linux)
and tools:

- .NET 10 **SDK** (not just the runtime), to run the supplied API.
- Node.js 22.12+ on 22.x, 24.x, or 26+, with npm.
- Git, and an editor or IDE you are comfortable with.
- Any AI coding assistant you normally use. We cannot provide AI access
  for at-home work.


Before you start working, follow the setup in `README.md`
and confirm that the starter runs and `dotnet test` passes. Contact us if 
the starter does not run; do not spend your own time debugging it.

The README shows commands in PowerShell; equivalent commands in another
shell are fine.

**Working in our office.** We provide a prepared computer with these
tools installed, the starter already building, and GitHub Copilot.

## Three-hour effort budget

We don't expect you to spend more than about three hours on design, 
implementation, verification, and your submission notes. At home,
choose any time within the agreedweek; this is not a request to use every 
available evening. In our office, the three hours are a fixed morning session
followed by a short break. 

AI assistants, agents, documentation, and normal development tools are
allowed throughout. You remain responsible for understanding and
explaining the result. We do not require chat transcripts.

A coherent partial solution is acceptable. Prioritize the required
behavior and be explicit about what remains. Extra features and
additional hours are not rewarded.

## Scope boundaries

Use the fixed drawer and transaction data supplied by the API. No login,
supervisor approval, denomination counting, payment integration,
printing, deployment, multiple currencies, or historical reporting is
required. You may read the C# service, but do not change it.

## Submit

- Commit your source, `package-lock.json`, and any tests you add. Do not
  commit build output or downloaded dependencies.
- Include short notes covering how to run your work, important decisions,
  how you checked it, known limitations, and approximate time spent.
- Identify any starter files you intentionally changed.

We assess correctness and domain understanding, engineering judgment,
verification, and the ability to explain and adapt your work. We do not
score the number of prompts, commits, libraries, or lines of code.

## Presentation and interviews

Plan for 90 to 120 minutes in our office:

- **About 75 minutes with the technical team.** Demonstrate your API,
  trace important behavior through your code, explain your design
  choices, tradeoffs, and incomplete parts, and explore or make one small
  change. This is a working discussion, not a presentation contest or a test 
  of memorized syntax. However, you will be expected to understand the 
  code you have produced. You may be asked to review a change to it.
- **A couple of short fit and background conversations** with colleagues
  from outside the engineering team.

We aim to give you a decision within 24 hours of the presentation.
