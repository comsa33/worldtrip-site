import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, Globe, Compass, Map, User } from 'lucide-react';
import './Header.css';

const navItems = [
  { path: '/', label: 'Home', icon: Globe },
  { path: '/journey', label: 'Journey', icon: Compass },
  { path: '/countries', label: 'Countries', icon: Map },
  { path: '/about', label: 'About', icon: User },
];

export default function Header() {
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  // Prevent scroll when menu is open
  useEffect(() => {
    if (isMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMenuOpen]);
  
  return (
    <header className={`header ${isScrolled ? 'header--scrolled' : ''}`}>
      <div className="header__container container">
        {/* Logo */}
        <Link to="/" className="header__logo">
          <div className="logo-mark">
            <Globe size={20} />
          </div>
          <div className="logo-text">
            <span className="logo-title">World Trip</span>
            <span className="logo-date">2016—17</span>
          </div>
        </Link>
        
        {/* Desktop Navigation */}
        <nav className="header__nav">
          {navItems.map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              className={`nav-link ${location.pathname === path ? 'nav-link--active' : ''}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        
        {/* Mobile Menu Toggle */}
        <button
          className="header__menu-toggle"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
        >
          {isMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      
      {/* Mobile Navigation */}
      <div className={`header__mobile-overlay ${isMenuOpen ? 'is-open' : ''}`} onClick={() => setIsMenuOpen(false)} />
      <nav className={`header__mobile-nav ${isMenuOpen ? 'is-open' : ''}`}>
        <div className="mobile-nav__content">
          {navItems.map(({ path, label, icon: Icon }, index) => (
            <Link
              key={path}
              to={path}
              className={`mobile-nav-link ${location.pathname === path ? 'mobile-nav-link--active' : ''}`}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <Icon size={22} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
