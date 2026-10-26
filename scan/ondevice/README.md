# On-device photo model

The iPhone uses a bundled Core ML image encoder to suggest photos for human review. Its eight categories identify visible subjects, such as rugs and bathroom fixtures; they do not confirm hazards.

- `pilot.py`: compared candidate image encoders on our labelled photo set, using a fixed train/held-out split. We picked OpenCLIP ViT-B-32 (laion2b, MIT-licensed weights).
- `export_model.py`: converts the image encoder to Core ML (`ios/App/App/HazardModel/`) and writes the text-prompt vectors and thresholds. It also checks that Core ML and PyTorch give the same embeddings.
- `verify_native.py`: compiles the Swift helpers on the Mac and checks that the phone's resizing and scoring match Python.
- `report.py`: writes summary numbers. Private photos and embeddings stay in the ignored `.cache/`.

Historical pilot metrics used machine-generated labels and a different item set; they do not establish accuracy for the current eight categories or real homes. The app keeps human review: flags are "possible, you decide", never findings.
