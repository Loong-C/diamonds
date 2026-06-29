# AlphaZero-style local AI training

This project can train a local policy/value model without any backend server.
The browser only ships the generated weights in `src/game/neuralModel.generated.ts`.

## What It Does

The training loop is AlphaZero-style:

1. A policy/value neural network evaluates public game states.
2. MCTS uses the network's policy priors and value estimates to improve move selection.
3. Self-play games record each root MCTS visit distribution as the policy target.
4. Final win/loss/draw becomes the value target for every recorded state.
5. The generated model is evaluated against the search AI baseline and written back to the app.

The AI does not use the hidden deck order directly. MCTS samples plausible hidden deck orders from public information.

## Quick Smoke Test

```powershell
$env:AZ_ITERATIONS='1'
$env:AZ_SELF_PLAY_GAMES='2'
$env:AZ_MAX_MOVES='28'
$env:AZ_MCTS_SIMULATIONS='4'
$env:AZ_DECK_SAMPLES='1'
$env:AZ_EPOCHS='1'
$env:AZ_EVAL_GAMES='2'
$env:AZ_EVAL_SIMULATIONS='4'
npm run train:ai
```

This only verifies the pipeline. It is not expected to produce a strong model.

## Longer Training

```powershell
$env:AZ_ITERATIONS='8'
$env:AZ_SELF_PLAY_GAMES='80'
$env:AZ_MAX_MOVES='120'
$env:AZ_MCTS_SIMULATIONS='160'
$env:AZ_DECK_SAMPLES='4'
$env:AZ_EPOCHS='8'
$env:AZ_EVAL_GAMES='30'
$env:AZ_EVAL_SIMULATIONS='180'
npm run train:ai
```

For overnight experiments, increase `AZ_SELF_PLAY_GAMES` and `AZ_MCTS_SIMULATIONS` first.

## Activation Gate

The app uses AlphaZero-MCTS only after the generated model has at least:

- `16` self-play games
- `500` training samples

Before that, the game falls back to the search AI so a tiny smoke-test model does not weaken live play.

## Validation

After training:

```powershell
npm test
npm run build
```
