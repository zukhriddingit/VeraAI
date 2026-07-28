"use client";

import {
  CreateSearchProfileRequestSchema,
  CreateSearchProfileResponseSchema,
  SearchAmenityCodeSchema,
  SearchIntentInterpretResponseSchema,
  SearchProfileMutationErrorSchema,
  type SearchAmenityCode,
  type SearchIntentCommuteAnchor,
  type SearchIntentDraft,
  type SearchProfile
} from "@vera/domain";
import { useMemo, useState } from "react";

import {
  amenityLabel,
  createBlankSearchDraft,
  profileToSearchDraft
} from "./search-composer-model";

function numberOrNull(value: string): number | null {
  if (value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeErrorMessage(body: unknown, fallback: string): string {
  const parsed = SearchProfileMutationErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.message : fallback;
}

function validationErrors(input: unknown): Readonly<Record<string, string>> {
  const parsed = CreateSearchProfileRequestSchema.safeParse(input);
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String).join(".");
    errors[path] ??= issue.message;
  }
  return errors;
}

function selectedAmenity(
  draft: SearchIntentDraft,
  code: SearchAmenityCode
): SearchIntentDraft["amenities"][number] | null {
  return draft.amenities.find((amenity) => amenity.code === code) ?? null;
}

function profileSummary(profile: SearchProfile): string {
  const budget =
    profile.absoluteMonthlyMaximumCents === null
      ? "No maximum set"
      : `${new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0
        }).format(profile.absoluteMonthlyMaximumCents / 100)} max`;
  const home =
    profile.minimumBedrooms === null
      ? "Home size open"
      : `${String(profile.minimumBedrooms)}+ bedroom`;
  return `${budget}. ${home}.`;
}

export function SearchComposer({
  profiles,
  selectedProfileId,
  disabled,
  onProfileSelected,
  onProfileCreated
}: {
  profiles: readonly SearchProfile[];
  selectedProfileId: string;
  disabled: boolean;
  onProfileSelected(profileId: string): void;
  onProfileCreated(profile: SearchProfile): void;
}) {
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<SearchIntentDraft>(() => createBlankSearchDraft());
  const [basedOnProfileId, setBasedOnProfileId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );

  function openManualDraft(): void {
    setDraft(createBlankSearchDraft());
    setBasedOnProfileId(null);
    setEditorOpen(true);
    setError(null);
    setNotice("Manual entry is open. Unknown fields can stay blank.");
    setErrors({});
  }

  function editSelectedProfile(): void {
    if (selectedProfile === null) return;
    setDraft(profileToSearchDraft(selectedProfile));
    setBasedOnProfileId(selectedProfile.id);
    setEditorOpen(true);
    setError(null);
    setNotice("Saving this edit creates a new version. The current profile stays unchanged.");
    setErrors({});
  }

  async function interpretDescription(): Promise<void> {
    if (description.trim().length < 3 || interpreting) return;
    setInterpreting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/search-profiles/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description })
      });
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        setDraft(createBlankSearchDraft());
        setBasedOnProfileId(null);
        setEditorOpen(true);
        throw new Error(
          safeErrorMessage(
            body,
            "Vera could not interpret that description. Enter the filters manually."
          )
        );
      }
      const interpreted = SearchIntentInterpretResponseSchema.parse(body);
      setDraft(interpreted.draft);
      setBasedOnProfileId(null);
      setEditorOpen(true);
      setErrors({});
      setNotice("Draft ready. Review every field before saving.");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Vera could not interpret that description. Enter the filters manually."
      );
    } finally {
      setInterpreting(false);
    }
  }

  async function saveProfile(): Promise<void> {
    if (saving) return;
    const input = { draft, basedOnProfileId };
    const nextErrors = validationErrors(input);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setError("Review the highlighted search fields before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/search-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(safeErrorMessage(body, "The search profile could not be saved."));
      }
      const profile = CreateSearchProfileResponseSchema.parse(body).profile;
      onProfileCreated(profile);
      setEditorOpen(false);
      setBasedOnProfileId(null);
      setErrors({});
      setNotice(`Saved ${profile.name}, version ${String(profile.version)}. Search is still off.`);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The search profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function togglePet(animal: SearchIntentDraft["pets"][number], checked: boolean): void {
    setDraft((current) => ({
      ...current,
      pets: checked
        ? [...new Set([...current.pets, animal])]
        : current.pets.filter((value) => value !== animal)
    }));
  }

  function updateAmenity(
    code: SearchAmenityCode,
    enabled: boolean,
    priority: "required" | "preferred" = "preferred"
  ): void {
    setDraft((current) => ({
      ...current,
      amenities: enabled
        ? [...current.amenities.filter((amenity) => amenity.code !== code), { code, priority }]
        : current.amenities.filter((amenity) => amenity.code !== code)
    }));
  }

  function updateCommuteAnchor(index: number, patch: Partial<SearchIntentCommuteAnchor>): void {
    setDraft((current) => ({
      ...current,
      commuteAnchors: current.commuteAnchors.map((anchor, anchorIndex) =>
        anchorIndex === index ? { ...anchor, ...patch } : anchor
      )
    }));
  }

  function fieldError(path: string): string | null {
    return errors[`draft.${path}`] ?? null;
  }

  return (
    <section className="search-composer-shell" aria-labelledby="search-composer-heading">
      <div className="search-composer-heading">
        <div>
          <p className="eyebrow">Your search</p>
          <h2 id="search-composer-heading">Tell Vera what you&apos;re looking for.</h2>
          <p>
            Describe the home in your own words. Vera creates an unsaved draft for you to review.
          </p>
        </div>
        <span className="search-control-note">Nothing runs until you press Search now.</span>
      </div>

      <div className="search-composer-grid">
        <div className="search-description-panel">
          <label className="search-field" htmlFor="search-description">
            <span>Housing search description</span>
            <textarea
              id="search-description"
              rows={7}
              maxLength={2_000}
              value={description}
              disabled={disabled || interpreting}
              placeholder="Example: One bedroom in Boston, MA under $2,900. Move in September. No pets. Laundry in the building or unit."
              onChange={(event) => setDescription(event.target.value)}
            />
            <small>
              Include location, budget, bedrooms, bathrooms, timing, pets, commute, and amenities.
            </small>
          </label>
          <div className="search-composer-actions">
            <button
              className="primary-button"
              type="button"
              disabled={disabled || interpreting || description.trim().length < 3}
              onClick={() => void interpretDescription()}
            >
              {interpreting ? "Preparing draft..." : "Review my search"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={disabled || interpreting}
              onClick={openManualDraft}
            >
              Enter filters manually
            </button>
          </div>
        </div>

        <aside className="saved-search-panel" aria-label="Saved search profile">
          <label className="search-field" htmlFor="saved-search-profile">
            <span>Saved profile</span>
            <select
              id="saved-search-profile"
              value={selectedProfileId}
              disabled={disabled || profiles.length === 0}
              onChange={(event) => onProfileSelected(event.target.value)}
            >
              {profiles.length === 0 ? <option value="">No saved profiles</option> : null}
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} (v{String(profile.version)})
                </option>
              ))}
            </select>
          </label>
          {selectedProfile ? (
            <div className="saved-search-summary">
              <strong>{selectedProfile.locationText}</strong>
              <span>{profileSummary(selectedProfile)}</span>
              <button
                className="secondary-button"
                type="button"
                disabled={disabled}
                onClick={editSelectedProfile}
              >
                Edit as new version
              </button>
            </div>
          ) : (
            <div className="saved-search-empty">
              <strong>No profile selected</strong>
              <span>Describe a search or enter the filters manually.</span>
            </div>
          )}
        </aside>
      </div>

      {error ? (
        <div className="search-form-message search-form-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="search-form-message" role="status">
          {notice}
        </div>
      ) : null}

      {editorOpen ? (
        <form
          className="search-review-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveProfile();
          }}
        >
          <div className="search-review-heading">
            <div>
              <h3>Review the search profile</h3>
              <p>Blank means unknown. Vera will not guess or widen a missing requirement.</p>
            </div>
            <button className="text-button" type="button" onClick={() => setEditorOpen(false)}>
              Close review
            </button>
          </div>

          {draft.ambiguities.length > 0 ? (
            <div className="search-ambiguities" role="status">
              <strong>Needs your review</strong>
              <ul>
                {draft.ambiguities.map((ambiguity) => (
                  <li key={ambiguity}>{ambiguity}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="search-fields-grid">
            <label className="search-field">
              <span>Profile name</span>
              <input
                value={draft.profileName ?? ""}
                maxLength={120}
                aria-invalid={fieldError("profileName") !== null}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    profileName: event.target.value.trim().length > 0 ? event.target.value : null
                  }))
                }
              />
              {fieldError("profileName") ? <small>{fieldError("profileName")}</small> : null}
            </label>
            <label className="search-field">
              <span>Location</span>
              <input
                value={draft.locationText ?? ""}
                maxLength={120}
                placeholder="Boston, MA or 02134"
                aria-invalid={fieldError("locationText") !== null}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    locationText: event.target.value.trim().length > 0 ? event.target.value : null
                  }))
                }
              />
              <small>
                {fieldError("locationText") ?? "Use City, ST or a five-digit ZIP code."}
              </small>
            </label>
            <label className="search-field">
              <span>Target monthly budget</span>
              <input
                type="number"
                min="0"
                max="1000000"
                step="1"
                inputMode="numeric"
                value={draft.targetMonthlyBudgetDollars ?? ""}
                aria-invalid={fieldError("targetMonthlyBudgetDollars") !== null}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    targetMonthlyBudgetDollars: numberOrNull(event.target.value)
                  }))
                }
              />
              {fieldError("targetMonthlyBudgetDollars") ? (
                <small>{fieldError("targetMonthlyBudgetDollars")}</small>
              ) : null}
            </label>
            <label className="search-field">
              <span>Absolute monthly maximum</span>
              <input
                type="number"
                min="0"
                max="1000000"
                step="1"
                inputMode="numeric"
                value={draft.maximumMonthlyBudgetDollars ?? ""}
                aria-invalid={fieldError("maximumMonthlyBudgetDollars") !== null}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    maximumMonthlyBudgetDollars: numberOrNull(event.target.value)
                  }))
                }
              />
              {fieldError("maximumMonthlyBudgetDollars") ? (
                <small>{fieldError("maximumMonthlyBudgetDollars")}</small>
              ) : null}
            </label>
            <label className="search-field">
              <span>Minimum bedrooms</span>
              <input
                type="number"
                min="0"
                max="20"
                step="0.5"
                value={draft.minimumBedrooms ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    minimumBedrooms: numberOrNull(event.target.value)
                  }))
                }
              />
            </label>
            <label className="search-field">
              <span>Minimum bathrooms</span>
              <input
                type="number"
                min="0"
                max="20"
                step="0.5"
                value={draft.minimumBathrooms ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    minimumBathrooms: numberOrNull(event.target.value)
                  }))
                }
              />
            </label>
            <label className="search-field">
              <span>Earliest move-in</span>
              <input
                type="date"
                value={draft.moveInEarliest ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    moveInEarliest: event.target.value || null
                  }))
                }
              />
            </label>
            <label className="search-field">
              <span>Latest move-in</span>
              <input
                type="date"
                value={draft.moveInLatest ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    moveInLatest: event.target.value || null
                  }))
                }
              />
            </label>
          </div>

          <fieldset className="search-choice-group">
            <legend>Pets that must be allowed</legend>
            <div className="search-choice-row">
              {(["cat", "dog", "other"] as const).map((animal) => (
                <label key={animal}>
                  <input
                    type="checkbox"
                    checked={draft.pets.includes(animal)}
                    onChange={(event) => togglePet(animal, event.target.checked)}
                  />
                  <span>{animal === "other" ? "Other pet" : animal}</span>
                </label>
              ))}
            </div>
            <small>Leave all unchecked when you do not need a pet policy.</small>
          </fieldset>

          <fieldset className="search-choice-group">
            <legend>Amenities</legend>
            <div className="amenity-review-grid">
              {SearchAmenityCodeSchema.options.map((code) => {
                const selected = selectedAmenity(draft, code);
                return (
                  <div className="amenity-review-row" key={code}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected !== null}
                        onChange={(event) => updateAmenity(code, event.target.checked)}
                      />
                      <span>{amenityLabel(code)}</span>
                    </label>
                    <select
                      aria-label={`${amenityLabel(code)} priority`}
                      value={selected?.priority ?? "preferred"}
                      disabled={selected === null}
                      onChange={(event) =>
                        updateAmenity(
                          code,
                          true,
                          event.target.value === "required" ? "required" : "preferred"
                        )
                      }
                    >
                      <option value="preferred">Preferred</option>
                      <option value="required">Required</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="search-choice-group">
            <div className="commute-heading">
              <legend>Commute anchors</legend>
              <button
                className="secondary-button"
                type="button"
                disabled={draft.commuteAnchors.length >= 5}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    commuteAnchors: [
                      ...current.commuteAnchors,
                      {
                        label: "",
                        locationText: "",
                        maximumMinutes: 30,
                        mode: "transit"
                      }
                    ]
                  }))
                }
              >
                Add commute anchor
              </button>
            </div>
            {draft.commuteAnchors.length === 0 ? (
              <p className="commute-empty">No commute requirement configured.</p>
            ) : (
              <div className="commute-anchor-list">
                {draft.commuteAnchors.map((anchor, index) => (
                  <div className="commute-anchor-row" key={`commute-${String(index)}`}>
                    <label className="search-field">
                      <span>Label</span>
                      <input
                        value={anchor.label}
                        maxLength={120}
                        onChange={(event) =>
                          updateCommuteAnchor(index, { label: event.target.value })
                        }
                      />
                    </label>
                    <label className="search-field">
                      <span>Destination</span>
                      <input
                        value={anchor.locationText}
                        maxLength={300}
                        onChange={(event) =>
                          updateCommuteAnchor(index, { locationText: event.target.value })
                        }
                      />
                    </label>
                    <label className="search-field">
                      <span>Maximum minutes</span>
                      <input
                        type="number"
                        min="1"
                        max="240"
                        step="1"
                        value={anchor.maximumMinutes}
                        onChange={(event) =>
                          updateCommuteAnchor(index, {
                            maximumMinutes: numberOrNull(event.target.value) ?? 0
                          })
                        }
                      />
                    </label>
                    <label className="search-field">
                      <span>Travel mode</span>
                      <select
                        value={anchor.mode}
                        onChange={(event) =>
                          updateCommuteAnchor(index, {
                            mode: event.target.value as SearchIntentCommuteAnchor["mode"]
                          })
                        }
                      >
                        <option value="walking">Walking</option>
                        <option value="cycling">Cycling</option>
                        <option value="transit">Transit</option>
                        <option value="driving">Driving</option>
                      </select>
                    </label>
                    <button
                      className="text-button commute-remove"
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          commuteAnchors: current.commuteAnchors.filter(
                            (_value, anchorIndex) => anchorIndex !== index
                          )
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          <div className="search-save-row">
            <div>
              <strong>Saving does not run a search.</strong>
              <span>You will confirm external API usage in the next panel.</span>
            </div>
            <button className="primary-button" type="submit" disabled={saving || disabled}>
              {saving ? "Saving profile..." : "Save profile"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
