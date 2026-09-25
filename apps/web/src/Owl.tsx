type OwlProps = {
  pose?: 'reading' | 'wave' | 'celebrate';
  className?: string;
  label?: string;
};

// Original, local vector artwork. Decorative instances stay out of the reading order.
export function Owl({ pose = 'reading', className = '', label }: OwlProps) {
  return (
    <svg
      className={`owl ${className}`}
      viewBox="0 0 240 250"
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <ellipse cx="121" cy="229" rx="69" ry="10" fill="#244F42" opacity=".1" />
      <path
        d="M88 218l-10 11m18-9-1 11m48-12 2 11m6-12 11 9"
        stroke="#B97831"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M64 116C52 146 51 180 67 204c22 32 81 32 105 2 18-24 16-62 3-91Z"
        fill="#769D77"
        stroke="#315C49"
        strokeWidth="3.5"
      />
      <ellipse cx="121" cy="180" rx="43" ry="39" fill="#F7EDCB" />
      {pose === 'reading' ? (
        <>
          <path
            d="M65 140c-27 7-30 38-9 50 8 3 18-8 24-18"
            fill="#4B7759"
            stroke="#315C49"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            d="M177 140c27 7 30 38 9 50-8 3-18-8-24-18"
            fill="#4B7759"
            stroke="#315C49"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <path
            d="M68 145c-25 0-45-19-45-40 0-7 8-10 13-4 13 16 27 15 42 22"
            fill="#769D77"
            stroke="#315C49"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            d={
              pose === 'celebrate'
                ? 'M173 145c25 0 45-19 45-40 0-7-8-10-13-4-13 16-27 15-42 22'
                : 'M177 145c29 9 31 40 10 46-10 2-18-10-23-23'
            }
            fill="#769D77"
            stroke="#315C49"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </>
      )}
      <path
        d="M53 93 50 40q2-9 11-4l34 22q26-9 52 0l35-22q9-5 9 5l-3 53c22 48-11 80-66 80S30 143 53 93Z"
        fill="#769D77"
        stroke="#315C49"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path d="m63 51 4 31 20-17Zm112 0-4 31-20-17Z" fill="#416D52" />
      <path
        d="M121 93c-36-40-78-8-67 31 8 29 42 34 67 37 25-3 59-8 67-37 11-39-31-71-67-31Z"
        fill="#FFF7DE"
      />
      <circle cx="91" cy="113" r="22" fill="#fffdf5" stroke="#DCCC9D" strokeWidth="2" />
      <circle cx="151" cy="113" r="22" fill="#fffdf5" stroke="#DCCC9D" strokeWidth="2" />
      {pose === 'celebrate' ? (
        <path
          d="M82 114q9-13 18 0m42 0q9-13 18 0"
          stroke="#284B3E"
          strokeWidth="5"
          strokeLinecap="round"
        />
      ) : (
        <>
          <ellipse cx="94" cy="113" rx="9" ry="12" fill="#284B3E" />
          <ellipse cx="148" cy="113" rx="9" ry="12" fill="#284B3E" />
          <circle cx="97" cy="109" r="3" fill="white" />
          <circle cx="151" cy="109" r="3" fill="white" />
        </>
      )}
      <ellipse cx="75" cy="139" rx="10" ry="5" fill="#EAA98D" opacity=".85" />
      <ellipse cx="167" cy="139" rx="10" ry="5" fill="#EAA98D" opacity=".85" />
      <path
        d="m112 132 9-5 9 5-9 13Z"
        fill="#E6A244"
        stroke="#BE792C"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {pose === 'reading' ? (
        <g stroke="#315C49" strokeWidth="3" strokeLinejoin="round">
          <path d="M75 172q22-5 46 8 24-13 46-8v39q-24-5-46 8-22-13-46-8Z" fill="#DF977E" />
          <path d="M80 165q22 0 41 11 19-11 41-11v39q-22 0-41 11-19-11-41-11Z" fill="#FFFAEA" />
          <path
            d="M121 178v36m-31-35 21 7m-21 5 16 5m27-10 20-7m-20 18 20-6"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      ) : (
        <path
          d="m102 178 5 5 5-5m14 0 5 5 5-5m-22 16 6 5 6-5"
          stroke="#C4AC71"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <path d="m205 51 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z" fill="#EAB958" />
      <circle cx="31" cy="72" r="4" fill="#EAA98D" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <svg viewBox="0 0 48 48" className="brand-icon" aria-hidden="true" focusable="false">
        <rect width="48" height="48" rx="16" fill="#245747" />
        <path d="m10 12 10 5h8l10-5-2 22q-12 11-24 0Z" fill="#F6ECCB" />
        <circle cx="18" cy="27" r="7" fill="#fffdf6" />
        <circle cx="30" cy="27" r="7" fill="#fffdf6" />
        <circle cx="19" cy="27" r="3" fill="#245747" />
        <circle cx="29" cy="27" r="3" fill="#245747" />
        <path d="m21 32 3-3 3 3-3 4Z" fill="#D69A3D" />
      </svg>
      <span>
        Classwork<span className="brand-period">.</span>
      </span>
    </div>
  );
}

export function WorkspaceIcon({ name }: { name: 'assignments' | 'classes' | 'account' }) {
  return (
    <svg
      className="workspace-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'assignments' ? (
        <>
          <rect x="5" y="4" width="14" height="17" rx="3" />
          <path d="M9 3h6v4H9Zm0 9h6m-6 4h4" />
        </>
      ) : name === 'classes' ? (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" />
        </>
      ) : (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
        </>
      )}
    </svg>
  );
}
