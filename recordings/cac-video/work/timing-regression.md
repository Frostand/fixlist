# Caption concat clock regression

Detected by inspecting video stream nb_frames separately from container duration: 4,968 video frames / 165.6 s versus 172 s audio/container. Some scenes ended at voice length despite longer intended holds.

Root cause: final repeated blank PNG in each concat caption track lacked `option framerate 30`; ffmpeg inferred 25 fps for that entry and rescaled its PTS backward. Before fix scene 1 caption packet PTS ended `7.100000, 6.333333` (non-monotonic). Adding the one missing option changed that ending to `7.100000, 7.600000`.

Fix: explicit 30 fps for every entry, including the final repeat. Added runtime per-scene frame-count/duration guard and final 5,160-frame guard, so container audio length cannot conceal missing video. Full stand-in rerender is the regression check.
