import { Search, X } from 'lucide-react';

export default function SearchBar({ value, onChange, placeholder = 'Search…', label = 'Search', className = '' }) {
  return (
    <div className={`evsu-search ${className}`} role="search">
      <Search size={16} aria-hidden="true" className="evsu-search__icon" />
      <input
        type="search"
        className="form-control"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {value && (
        <button type="button" className="evsu-search__clear" onClick={() => onChange('')} aria-label="Clear search">
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
